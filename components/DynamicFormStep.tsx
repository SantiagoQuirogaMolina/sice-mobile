/**
 * DynamicFormStep — renderiza el formulario dinámico del evento (Tipo B) en la
 * captura del operador. Espejo del `DataStep` de la web
 * (`app/event/[id]/delivery/[citizenId]/page.tsx`), adaptado a React Native.
 *
 * Reglas:
 *   - Los campos de identidad (doc_type / doc_number / full_name) NO se vuelven
 *     a pedir: ya se conocen por la cédula del beneficiario. Se muestran
 *     solo-lectura con un sello "Ya identificado" y sus valores se siembran en
 *     el estado para que viajen en customFormData (igual que el auto-registro
 *     QR).
 *   - text/number/phone/textarea → Input (teclado numérico en number/phone,
 *     multilínea en textarea).
 *   - select/radio → chips (copiado del patrón DOCUMENT_TYPES de new.tsx).
 *   - checkbox → toggles multi-selección; se guarda como string unida por ', '
 *     (mismo formato que la web).
 *   - date → Input con placeholder dd/mm/aaaa (sin date-picker para no sumar
 *     dependencias).
 *   - photo/file → cámara nativa (expo-camera, mismo patrón que el PhotoStep
 *     del wizard). No hay image/document-picker en el proyecto, así que file
 *     también se captura con la cámara. Se guarda
 *     { kind:'photo'|'file', dataUrl, sha256, filename, mime }. photo+multiple
 *     guarda un array.
 *   - gps → expo-location (mismo patrón que el GpsStep del wizard). Se guarda
 *     { lat, lon, accuracy, status }.
 */

import { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { Button } from './Button';
import { Input } from './Input';
import { sha256OfDataUrl } from '../lib/crypto/hash';
import { compressEvidencePhoto } from '../lib/media/image';
import type { GestorFormField } from '../lib/api/services/events.service';
import {
  colors,
  fontSizes,
  fontWeights,
  radii,
  spacing,
  TOUCH_MIN,
} from '../lib/theme/tokens';

/** Campos de identidad fijos: ya capturados con la cédula → solo-lectura. */
const IDENTITY_FIELD_NAMES = new Set(['doc_type', 'doc_number', 'full_name']);

/** Tope de peso del documento. El backend rechaza evidencia >8MB en base64
 *  (~6MB binarios) con 400 y la entrega queda bloqueada. Capamos a 5MB binarios
 *  (~6.7MB base64) para quedar holgados y mantener los archivos livianos. */
const MAX_FILE_BYTES = 5 * 1024 * 1024;
/** Tipos de documento permitidos (seguros): PDF, Word, Excel + imágenes. */
const SAFE_DOC_MIMES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];
/** Lo que se le ofrece al selector (incluye comodín de imágenes). */
const PICKER_DOC_TYPES = [...SAFE_DOC_MIMES, 'image/*'];
function isSafeFileMime(mime: string): boolean {
  return SAFE_DOC_MIMES.includes(mime) || mime.startsWith('image/');
}

/** Valor capturado de un campo foto/documento. */
interface CapturedFile {
  kind: 'photo' | 'file';
  dataUrl: string;
  sha256: string;
  filename: string;
  mime: string;
}

/** Valor capturado de un campo GPS. */
interface CapturedGps {
  lat: number;
  lon: number;
  accuracy: number | null;
  status: 'ok' | 'indeterminada';
}

interface DynamicFormStepProps {
  fields: GestorFormField[];
  beneficiary: {
    documentType: string;
    documentNumber: string;
    fullName: string;
  };
  initial: Record<string, unknown>;
  stepIndex: number;
  total: number;
  onContinue: (values: Record<string, unknown>) => void;
}

function asFileList(value: unknown): CapturedFile[] {
  if (Array.isArray(value)) return value as CapturedFile[];
  if (value && typeof value === 'object' && 'dataUrl' in value) {
    return [value as CapturedFile];
  }
  return [];
}

export function DynamicFormStep({
  fields,
  beneficiary,
  initial,
  stepIndex,
  total,
  onContinue,
}: DynamicFormStepProps) {
  // Siembra: identidad pre-llenada desde el beneficiario; resto desde initial.
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const seed: Record<string, unknown> = { ...(initial ?? {}) };
    for (const f of fields) {
      if (f.name === 'doc_type') seed[f.name] = beneficiary.documentType;
      else if (f.name === 'doc_number') seed[f.name] = beneficiary.documentNumber;
      else if (f.name === 'full_name') seed[f.name] = beneficiary.fullName;
    }
    return seed;
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Campo foto/documento que está capturando ahora mismo (overlay de cámara).
  const [capturingField, setCapturingField] = useState<GestorFormField | null>(
    null,
  );

  const update = (name: string, val: unknown) => {
    setValues((v) => ({ ...v, [name]: val }));
    setErrors((e) => ({ ...e, [name]: '' }));
  };

  // Campo 'file' (documento): selector de archivo del teléfono (PDF/imagen),
  // alternativa a tomar foto. La web usa <input type=file>; igualamos eso.
  const pickFile = async (field: GestorFormField) => {
    try {
      const accept = field.accept
        ? field.accept.split(',').map((s) => s.trim()).filter(Boolean)
        : PICKER_DOC_TYPES;
      const res = await DocumentPicker.getDocumentAsync({
        type: accept,
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const asset = res.assets[0];
      // Validar ANTES de leer el base64 (un archivo gigante revienta memoria y
      // el servidor lo rechaza con 400 → la entrega quedaba bloqueada). Tope de
      // peso + tipos seguros (PDF/Word/Excel/imagen).
      const mimeGuess = asset.mimeType ?? '';
      if (mimeGuess && !isSafeFileMime(mimeGuess)) {
        Alert.alert(
          'Tipo de archivo no permitido',
          'Solo se aceptan PDF, Word, Excel o imágenes. Elige otro archivo o toma una foto del documento.',
        );
        return;
      }
      if ((asset.size ?? 0) > MAX_FILE_BYTES) {
        Alert.alert(
          'Archivo muy pesado',
          `El archivo pesa ${((asset.size ?? 0) / 1048576).toFixed(1)} MB y el máximo es ${MAX_FILE_BYTES / 1048576} MB. Elige uno más liviano o toma una foto del documento.`,
        );
        return;
      }
      // Leer el archivo como base64 (API File de expo-file-system v19). El SHA-256
      // se calcula sobre ese contenido → misma cadena de integridad que las fotos.
      const base64 = await new File(asset.uri).base64();
      const mime = asset.mimeType ?? 'application/octet-stream';
      const dataUrl = `data:${mime};base64,${base64}`;
      const sha256 = await sha256OfDataUrl(dataUrl);
      const captured: CapturedFile = {
        kind: 'file',
        dataUrl,
        sha256,
        filename: asset.name ?? 'archivo',
        mime,
      };
      update(field.name, captured);
    } catch (e) {
      Alert.alert(
        'No se pudo leer el archivo',
        e instanceof Error ? e.message : 'Intenta de nuevo o toma una foto del documento.',
      );
    }
  };

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    for (const f of fields) {
      if (f.type === 'photo' || f.type === 'file') {
        if (f.required && asFileList(values[f.name]).length === 0) {
          errs[f.name] = 'Requerido';
        }
        continue;
      }
      if (f.type === 'gps') {
        if (f.required && !values[f.name]) errs[f.name] = 'Requerido';
        continue;
      }
      if (f.required && !values[f.name]) {
        errs[f.name] = 'Requerido';
      }
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  // Overlay de captura de cámara: ocupa la pantalla mientras se toma la foto.
  if (capturingField) {
    return (
      <CameraCapture
        multiple={capturingField.type === 'photo' && !!capturingField.multiple}
        existing={asFileList(values[capturingField.name])}
        kind={capturingField.type === 'file' ? 'file' : 'photo'}
        onCancel={() => setCapturingField(null)}
        onDone={(captured) => {
          update(capturingField.name, captured);
          setCapturingField(null);
        }}
      />
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.body}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
      <Text style={styles.stepKicker}>
        Paso {stepIndex + 1} de {total}
      </Text>
      <Text style={styles.h1}>Datos del formulario</Text>
      <Text style={styles.h2}>
        La identidad ya quedó cargada con la cédula (se muestra fija abajo).
        Completa los demás datos que pide el formulario.
      </Text>

      <View style={styles.card}>
        {fields.map((f) => (
          <FieldRow
            key={f.id}
            field={f}
            value={values[f.name]}
            error={errors[f.name]}
            onChange={(v) => update(f.name, v)}
            onCapture={() => setCapturingField(f)}
            onPickFile={() => void pickFile(f)}
          />
        ))}
      </View>

      <Button
        label="Confirmar datos"
        onPress={() => {
          if (validate()) onContinue(values);
        }}
      />
    </ScrollView>
  );
}

/* ─────────────────────────── Field row ─────────────────────────── */

function FieldRow({
  field,
  value,
  error,
  onChange,
  onCapture,
  onPickFile,
}: {
  field: GestorFormField;
  value: unknown;
  error?: string;
  onChange: (v: unknown) => void;
  onCapture: () => void;
  onPickFile: () => void;
}) {
  const isIdentity = IDENTITY_FIELD_NAMES.has(field.name);

  // Identidad: solo-lectura, valor sembrado desde el beneficiario.
  if (isIdentity) {
    return (
      <View style={styles.field}>
        <FieldLabel field={field} />
        <View style={styles.identityBox}>
          <Text style={styles.identityValue} numberOfLines={1}>
            {String(value ?? '—')}
          </Text>
          <Text style={styles.identityBadge}>✓ Ya identificado</Text>
        </View>
      </View>
    );
  }

  // select/radio sin opciones configuradas → degradar a un input de texto para no
  // dejar un control muerto que impida completar (el backend no valida options).
  const selectNoOptions =
    (field.type === 'select' || field.type === 'radio') &&
    (field.options?.length ?? 0) === 0;

  // Inputs de texto (Input ya pinta su propio label + error).
  if (
    field.type === 'text' ||
    field.type === 'textarea' ||
    field.type === 'number' ||
    field.type === 'phone' ||
    selectNoOptions
  ) {
    return (
      <View style={styles.field}>
        <TextField field={field} value={value} error={error} onChange={onChange} />
      </View>
    );
  }

  // Fecha → date picker nativo.
  if (field.type === 'date') {
    return (
      <View style={styles.field}>
        <DateField field={field} value={value} error={error} onChange={onChange} />
      </View>
    );
  }

  // Resto de controles: usan FieldLabel + helper/error abajo.
  return (
    <View style={styles.field}>
      <FieldLabel field={field} />
      {field.type === 'select' || field.type === 'radio' ? (
        <ChipField field={field} value={value} onChange={onChange} />
      ) : field.type === 'checkbox' ? (
        <CheckboxField field={field} value={value} onChange={onChange} />
      ) : field.type === 'photo' || field.type === 'file' ? (
        <FileField
          field={field}
          value={value}
          onCapture={onCapture}
          onPickFile={onPickFile}
          onChange={onChange}
        />
      ) : field.type === 'gps' ? (
        <GpsField value={value} onChange={onChange} />
      ) : null}
      {field.helper && !error ? (
        <Text style={styles.helper}>{field.helper}</Text>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function FieldLabel({ field }: { field: GestorFormField }) {
  return (
    <Text style={styles.label}>
      {field.label}
      {field.required ? <Text style={styles.required}> *</Text> : null}
    </Text>
  );
}

/* ─────────────────────────── Text / number / phone / textarea / date ───────────────────────────
 *
 * Usa el componente Input (que ya pinta label + error). number/phone → teclado
 * numérico; textarea → multilínea; date → placeholder dd/mm/aaaa.
 */
function TextField({
  field,
  value,
  error,
  onChange,
}: {
  field: GestorFormField;
  value: unknown;
  error?: string;
  onChange: (v: unknown) => void;
}) {
  const isNumeric = field.type === 'number' || field.type === 'phone';
  const label = field.required ? `${field.label} *` : field.label;
  const placeholder =
    field.type === 'date'
      ? 'dd/mm/aaaa'
      : field.placeholder ?? field.helper ?? undefined;

  return (
    <Input
      label={label}
      value={(value as string) ?? ''}
      onChangeText={(v) =>
        onChange(field.type === 'number' ? v.replace(/[^\d]/g, '') : v)
      }
      error={error}
      hint={field.type !== 'date' ? field.helper : undefined}
      placeholder={placeholder}
      keyboardType={
        field.type === 'number'
          ? 'number-pad'
          : field.type === 'phone'
            ? 'phone-pad'
            : 'default'
      }
      multiline={field.type === 'textarea'}
      style={field.type === 'textarea' ? styles.textarea : undefined}
      autoCapitalize={field.type === 'textarea' ? 'sentences' : 'none'}
      autoCorrect={field.type === 'textarea'}
    />
  );
}

/* ─────────────────────────── Date (date picker nativo) ───────────────────────────
 *
 * Antes era un texto libre 'dd/mm/aaaa' sin validación (se podía escribir
 * cualquier cosa y nadie lo detectaba — el backend tampoco valida). Ahora usa el
 * date picker nativo y guarda SIEMPRE en ISO 'YYYY-MM-DD' (igual que la web con
 * <input type=date>), mostrando 'dd/mm/aaaa' al usuario.
 */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
/** Date → 'YYYY-MM-DD' con partes LOCALES (evita el off-by-one de toISOString). */
function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
/** 'YYYY-MM-DD' → 'dd/mm/aaaa' para mostrar. */
function isoToDisplay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

function DateField({
  field,
  value,
  error,
  onChange,
}: {
  field: GestorFormField;
  value: unknown;
  error?: string;
  onChange: (v: unknown) => void;
}) {
  const [show, setShow] = useState(false);
  const iso = typeof value === 'string' ? value : '';
  const display = iso ? isoToDisplay(iso) : '';
  const current = iso ? new Date(`${iso}T00:00:00`) : new Date();
  return (
    <>
      <FieldLabel field={field} />
      <Pressable
        onPress={() => setShow(true)}
        style={({ pressed }) => [styles.dateButton, pressed && { opacity: 0.85 }]}
      >
        <Text style={display ? styles.dateValue : styles.datePlaceholder}>
          {display || 'Seleccionar fecha (dd/mm/aaaa)'}
        </Text>
        <Text style={styles.dateIcon}>📅</Text>
      </Pressable>
      {field.helper && !error ? <Text style={styles.helper}>{field.helper}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {show && (
        <DateTimePicker
          value={current}
          mode="date"
          display="default"
          onChange={(event, selected) => {
            // En Android el diálogo se cierra solo; cerramos el flag igual.
            if (Platform.OS !== 'ios') setShow(false);
            if (event.type === 'set' && selected) onChange(toIsoDate(selected));
          }}
        />
      )}
    </>
  );
}

/* ─────────────────────────── Select / radio (chips) ─────────────────────────── */

function ChipField({
  field,
  value,
  onChange,
}: {
  field: GestorFormField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const selected = (value as string) ?? '';
  return (
    <View style={styles.chipRow}>
      {(field.options ?? []).map((o) => {
        const active = selected === o;
        return (
          <Pressable
            key={o}
            onPress={() => onChange(active ? '' : o)}
            style={({ pressed }) => [
              styles.chip,
              active && styles.chipActive,
              pressed && { opacity: 0.85 },
            ]}
          >
            <Text style={[styles.chipText, active && styles.chipTextActive]}>
              {o}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ─────────────────────────── Checkbox (multi) ─────────────────────────── */

function CheckboxField({
  field,
  value,
  onChange,
}: {
  field: GestorFormField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  // Mismo formato que la web: string unida por ', '.
  const selected = ((value as string) ?? '').split(', ').filter(Boolean);
  return (
    <View style={styles.checkboxList}>
      {(field.options ?? []).map((o) => {
        const checked = selected.includes(o);
        return (
          <Pressable
            key={o}
            onPress={() => {
              const next = checked
                ? selected.filter((s) => s !== o)
                : [...selected, o];
              onChange(next.join(', '));
            }}
            style={({ pressed }) => [
              styles.checkboxRow,
              pressed && { opacity: 0.85 },
            ]}
          >
            <View style={[styles.checkboxBox, checked && styles.checkboxBoxChecked]}>
              {checked ? <Text style={styles.checkboxTick}>✓</Text> : null}
            </View>
            <Text style={styles.checkboxLabel}>{o}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ─────────────────────────── Photo / file ─────────────────────────── */

function FileField({
  field,
  value,
  onCapture,
  onPickFile,
  onChange,
}: {
  field: GestorFormField;
  value: unknown;
  onCapture: () => void;
  onPickFile: () => void;
  onChange: (v: unknown) => void;
}) {
  const items = asFileList(value);
  const isPhoto = field.type === 'photo';
  const multiple = isPhoto && !!field.multiple;

  const removeAt = (idx: number) => {
    const next = items.filter((_, i) => i !== idx);
    onChange(multiple ? next : next[0] ?? null);
  };

  return (
    <View style={styles.fileWrap}>
      {items.length > 0 && (
        <View style={styles.fileThumbs}>
          {items.map((it, i) => (
            <View key={`${it.sha256}-${i}`} style={styles.fileThumb}>
              {it.mime.startsWith('image/') ? (
                <Image source={{ uri: it.dataUrl }} style={styles.fileThumbImg} />
              ) : (
                <View style={styles.fileThumbDoc}>
                  <Text style={styles.fileThumbDocIcon}>📄</Text>
                </View>
              )}
              <Pressable
                onPress={() => removeAt(i)}
                style={({ pressed }) => [
                  styles.fileRemove,
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Text style={styles.fileRemoveText}>✕</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}
      {(multiple || items.length === 0) &&
        (isPhoto ? (
          <Button
            label={
              items.length > 0 && multiple ? '📸 Agregar otra foto' : '📸 Tomar foto'
            }
            variant="secondary"
            onPress={onCapture}
          />
        ) : (
          // Documento: elegir un archivo del teléfono (PDF/imagen) o tomar foto.
          <View style={styles.fileButtons}>
            <Button label="📎 Elegir archivo" variant="secondary" onPress={onPickFile} />
            <Button label="📷 Tomar foto" variant="ghost" onPress={onCapture} />
          </View>
        ))}
    </View>
  );
}

/* ─────────────────────────── GPS ─────────────────────────── */

function GpsField({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const captured = value as CapturedGps | undefined;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const capture = async () => {
    setBusy(true);
    setErr(null);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        setErr('Permiso de ubicación denegado.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      onChange({
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        accuracy: pos.coords.accuracy ?? null,
        status: 'ok',
      } satisfies CapturedGps);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo obtener la ubicación.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.gpsWrap}>
      {captured && captured.status === 'ok' && (
        <View style={styles.gpsResult}>
          <Text style={styles.gpsCoord}>
            📍 {captured.lat.toFixed(6)}, {captured.lon.toFixed(6)}
          </Text>
          <Text style={styles.gpsAcc}>
            {captured.accuracy != null
              ? `Precisión ±${Math.round(captured.accuracy)}m`
              : 'Precisión desconocida'}
          </Text>
        </View>
      )}
      {err && <Text style={styles.error}>{err}</Text>}
      <Button
        label={
          busy
            ? 'Obteniendo…'
            : captured
              ? 'Actualizar ubicación'
              : 'Usar mi ubicación'
        }
        variant="secondary"
        onPress={() => void capture()}
        loading={busy}
        disabled={busy}
      />
    </View>
  );
}

/* ─────────────────────────── Camera overlay ───────────────────────────
 *
 * Mismo patrón que el PhotoStep del wizard de captura: permiso → preview de
 * cámara → tomar → confirmar. Se reutiliza para photo y file (no hay
 * document-picker en el proyecto, así que el documento también se fotografía).
 */
function CameraCapture({
  kind,
  multiple,
  existing,
  onCancel,
  onDone,
}: {
  kind: 'photo' | 'file';
  multiple: boolean;
  existing: CapturedFile[];
  onCancel: () => void;
  onDone: (captured: CapturedFile | CapturedFile[]) => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ dataUrl: string; sizeKB: number } | null>(
    null,
  );

  if (!permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.cyan} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.body}>
        <Text style={styles.h1}>Permiso de cámara</Text>
        <Text style={styles.h2}>
          SICE necesita acceso a la cámara para capturar la evidencia.
        </Text>
        <Button label="Conceder permiso" onPress={() => void requestPermission()} />
        <View style={{ marginTop: spacing.sm }}>
          <Button label="← Volver" variant="ghost" onPress={onCancel} />
        </View>
      </View>
    );
  }

  const takePicture = async () => {
    if (!cameraRef.current || busy) return;
    setBusy(true);
    setError(null);
    try {
      const pic = await cameraRef.current.takePictureAsync({
        quality: 1, // se recomprime una vez al redimensionar
        base64: false,
        skipProcessing: false,
      });
      if (pic?.uri) {
        // Redimensionar + comprimir (≈5× más liviano) para que la subida no se
        // corte por red móvil. El SHA-256 se calcula luego sobre este resultado.
        const result = await compressEvidencePhoto(pic.uri, pic.width, pic.height);
        if (result) {
          setPreview(result);
        } else {
          setError('No se procesó la imagen. Intenta de nuevo.');
        }
      } else {
        setError('No se capturó la imagen. Intenta de nuevo.');
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? `No se pudo tomar la foto: ${e.message}`
          : 'No se pudo tomar la foto. Intenta de nuevo.',
      );
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const sha256 = await sha256OfDataUrl(preview.dataUrl);
      const captured: CapturedFile = {
        kind,
        dataUrl: preview.dataUrl,
        sha256,
        filename: `${kind}-${Date.now()}.jpg`,
        mime: 'image/jpeg',
      };
      onDone(multiple ? [...existing, captured] : captured);
    } finally {
      setBusy(false);
    }
  };

  if (preview) {
    return (
      <View style={styles.body}>
        <Text style={styles.h1}>
          {kind === 'file' ? 'Documento' : 'Foto'} capturada
        </Text>
        <Text style={styles.h2}>
          Verifica que se lea claramente. Si está borrosa, vuelve a tomarla.
        </Text>
        <View style={styles.previewBox}>
          <Image source={{ uri: preview.dataUrl }} style={styles.previewImg} />
        </View>
        <Text style={styles.previewMeta}>{preview.sizeKB} KB</Text>
        <Button
          label={busy ? 'Guardando…' : 'Usar esta captura'}
          onPress={() => void confirm()}
          loading={busy}
          disabled={busy}
        />
        <View style={{ marginTop: spacing.sm }}>
          <Button
            label="Volver a tomar"
            variant="secondary"
            onPress={() => setPreview(null)}
            disabled={busy}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.body}>
      <Text style={styles.h1}>{kind === 'file' ? 'Capturar documento' : 'Tomar foto'}</Text>
      <Text style={styles.h2}>Encuadra y toca el botón de captura.</Text>
      <View style={styles.cameraBox}>
        <CameraView ref={cameraRef} style={styles.camera} facing="back" />
      </View>
      {error && (
        <View style={styles.photoErrorBox}>
          <Text style={styles.photoErrorText}>{error}</Text>
        </View>
      )}
      <Button
        label={busy ? 'Capturando…' : error ? '📸 Reintentar' : '📸 Capturar'}
        onPress={() => void takePicture()}
        loading={busy}
      />
      <View style={{ marginTop: spacing.sm }}>
        <Button label="← Cancelar" variant="ghost" onPress={onCancel} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  body: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl * 2,
    flexGrow: 1,
  },
  stepKicker: {
    color: colors.textMuted,
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  h1: {
    color: colors.textPrimary,
    fontSize: fontSizes.xl,
    fontWeight: fontWeights.extrabold,
  },
  h2: {
    color: colors.textSecondary,
    fontSize: fontSizes.sm,
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
    lineHeight: 20,
  },
  card: {
    backgroundColor: colors.bgCard,
    borderRadius: radii.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.lg,
  },
  field: {
    marginBottom: spacing.md,
  },
  label: {
    color: colors.textSecondary,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.medium,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  required: {
    color: colors.error,
  },
  helper: {
    color: colors.textMuted,
    fontSize: fontSizes.xs,
    marginTop: spacing.xs,
  },
  error: {
    color: colors.error,
    fontSize: fontSizes.xs,
    marginTop: spacing.xs,
  },
  textarea: {
    height: 100,
    paddingTop: spacing.sm,
    textAlignVertical: 'top',
  },
  identityBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    backgroundColor: colors.bgInput,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  identityValue: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: fontSizes.md,
    fontWeight: fontWeights.medium,
  },
  identityBadge: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: fontWeights.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    minWidth: 56,
    height: TOUCH_MIN,
    paddingHorizontal: spacing.md,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgInput,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipActive: {
    backgroundColor: colors.cyan,
    borderColor: colors.cyan,
  },
  chipText: {
    color: colors.textSecondary,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.bold,
  },
  chipTextActive: {
    color: colors.navyDark,
  },
  checkboxList: {
    gap: spacing.sm,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: TOUCH_MIN,
  },
  checkboxBox: {
    width: 24,
    height: 24,
    borderRadius: radii.sm,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    backgroundColor: colors.bgInput,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxBoxChecked: {
    backgroundColor: colors.cyan,
    borderColor: colors.cyan,
  },
  checkboxTick: {
    color: colors.navyDark,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.extrabold,
  },
  checkboxLabel: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: fontSizes.md,
  },
  fileWrap: {
    gap: spacing.sm,
  },
  fileButtons: {
    gap: spacing.sm,
  },
  dateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: TOUCH_MIN,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgInput,
  },
  dateValue: {
    color: colors.textPrimary,
    fontSize: fontSizes.md,
    fontVariant: ['tabular-nums'],
  },
  datePlaceholder: {
    color: colors.textMuted,
    fontSize: fontSizes.md,
  },
  dateIcon: {
    fontSize: fontSizes.md,
  },
  fileThumbs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  fileThumb: {
    width: 72,
    height: 72,
    borderRadius: radii.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgInput,
  },
  fileThumbImg: {
    width: '100%',
    height: '100%',
  },
  fileThumbDoc: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileThumbDocIcon: {
    fontSize: 28,
  },
  fileRemove: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(13,27,42,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileRemoveText: {
    color: colors.textPrimary,
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.bold,
  },
  gpsWrap: {
    gap: spacing.sm,
  },
  gpsResult: {
    backgroundColor: colors.bgInput,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  gpsCoord: {
    color: colors.textPrimary,
    fontSize: fontSizes.sm,
    fontVariant: ['tabular-nums'],
  },
  gpsAcc: {
    color: colors.textMuted,
    fontSize: fontSizes.xs,
    marginTop: 2,
  },
  cameraBox: {
    height: 380,
    borderRadius: radii.md,
    overflow: 'hidden',
    marginBottom: spacing.md,
    backgroundColor: 'black',
  },
  camera: {
    flex: 1,
  },
  previewBox: {
    height: 380,
    borderRadius: radii.md,
    overflow: 'hidden',
    marginBottom: spacing.sm,
    backgroundColor: 'black',
  },
  previewImg: {
    flex: 1,
    width: '100%',
  },
  previewMeta: {
    color: colors.textMuted,
    fontSize: fontSizes.xs,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  photoErrorBox: {
    backgroundColor: colors.bgCard,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.error,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  photoErrorText: {
    color: colors.error,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.semibold,
    textAlign: 'center',
  },
});
