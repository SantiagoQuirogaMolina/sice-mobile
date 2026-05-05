# SICE Mobile — Release & Distribución

Guía operativa para generar APKs firmadas y distribuírselas a operadores en
campo. Pensada para Android only (no iOS por ahora).

---

## 0. Setup inicial (una sola vez)

### 0.1. Instalar EAS CLI

```bash
npm install -g eas-cli
```

> Si nunca instalaste npm packages globales en tu PC, podés tener que
> agregar el path con permisos de admin. En la práctica `npm install -g`
> alcanza.

### 0.2. Login

```bash
eas login
```

Te pide email/contraseña de tu cuenta Expo. Esos credenciales quedan
guardados localmente en `~/.expo/state.json`. Ya no los volvés a
ingresar hasta que cambies de máquina.

Cuenta SICE: `santiagoquirogamolina1999@gmail.com` / username
`santiquirogamolina` en https://expo.dev.

### 0.3. Vincular el proyecto

La primera vez que corras un `eas build` te va a preguntar si querés
crear el proyecto en tu cuenta. Decí que sí (`y`). El `slug` ya está
fijado en `app.json` como `sice-operador` y el `owner` como
`santiquirogamolina`, así que lo va a crear como
`@santiquirogamolina/sice-operador` automáticamente.

### 0.4. Generar keystore

EAS lo hace por vos en la primera build. Te va a preguntar:

```
Generate a new Android Keystore? (Y/n)
```

Decí `Y`. Queda guardado en los servidores de EAS y NO se borra.

> ⚠️ **Crítico**: si en algún momento ese keystore se pierde, ningún
> operador podrá actualizar la APK (Android los rechaza). Tienen que
> desinstalar y reinstalar la nueva. Si querés tener una copia local de
> respaldo, corré `eas credentials` y descargálo.

---

## 1. Generar APK firmada (preview, para operadores beta)

```bash
eas build --profile preview --platform android
```

- Sube tu código a EAS y compila Android nativo en sus servidores.
- Lleva 15–25 min la primera vez (cola + compile + sign).
- Las builds siguientes pueden tomar 8–12 min porque hay caché.
- El comando imprime una URL tipo
  `https://expo.dev/accounts/santiquirogamolina/projects/sice-operador/builds/<id>`.
  Esa URL muestra el progreso en vivo.

Cuando termina, en esa URL (o en https://expo.dev/builds) ves un botón
**Install** que te genera un QR + link directo a un `.apk`. Lo bajás y
ya lo podés mandar.

**Tamaño esperado**: ~70–90 MB. Lo manda por Drive, WhatsApp Business
(soporta archivos grandes), email, o USB.

---

## 2. Bumping de versión (cada release nueva)

Antes de lanzar `eas build`, actualizá `app.json`:

```jsonc
{
  "expo": {
    "version": "1.0.1",          // semver visible al usuario
    "android": {
      "versionCode": 2            // SIEMPRE +1, número entero
    }
  }
}
```

- `version` es el número que ven los operadores en Settings → Apps.
- `versionCode` es lo que Android usa internamente para detectar
  "instalada vs nueva". Tiene que ser **estrictamente mayor** que el
  versionCode anterior, si no Android rechaza la instalación con
  `INSTALL_FAILED_VERSION_DOWNGRADE`.

Convención propuesta:
- 1.0.x = parches (bugs).
- 1.x.0 = features nuevas (ej. Sprint 10 → 1.1.0).
- 2.0.0 = cambio mayor.

---

## 3. Instalar la APK en un Android nuevo (operador en campo)

1. El operador recibe el `.apk` (Drive, WhatsApp, email).
2. Lo descarga al celular.
3. Abre el archivo desde el explorador de archivos.
4. Android le va a pedir permiso "Install from unknown sources" para
   esa app (Chrome, Files, lo que esté abriendo el .apk). Le dice
   **Permitir**.
5. Instala. Aparece "SICE Operador" en el launcher con el icono.
6. Primera vez que abre, le pide:
   - Cámara → Permitir.
   - Ubicación → Permitir cuando se use la app.
7. Login con sus credenciales (gestor / asistente / maría / etc).
8. Listo — ya puede capturar.

---

## 4. Pre-build checklist (antes de cada release)

```bash
# 1. Verificar TypeScript limpio
npm run typecheck

# 2. Lint sin errores
npm run lint

# 3. Bumpear version + versionCode en app.json
# (manual, según punto 2 de este doc)

# 4. Commit & push
git add app.json
git commit -m "chore: bump version a 1.0.x"
git push

# 5. Build
eas build --profile preview --platform android
```

---

## 5. Perfiles disponibles (`eas.json`)

| Perfil | Build type | Para qué | Comando |
|---|---|---|---|
| `development` | APK debug | Vos, con dev client (live reload) | `eas build --profile development --platform android` |
| `preview` | APK firmada release | **Distribución a operadores beta** ← el que importa | `eas build --profile preview --platform android` |
| `production` | AAB (Android App Bundle) | Subir a Play Store en Sprint 10 | `eas build --profile production --platform android` |

El `preview` y `production` ya tienen pinneado
`EXPO_PUBLIC_API_URL=https://sice-backend-production.up.railway.app`
para que la app no quede apuntando a un localhost que no existe en el
celular del operador.

---

## 6. OTA updates (Sprint 10, no ahora)

Hoy, cualquier cambio de código requiere una APK nueva → operador la
reinstala. En Sprint 10 vamos a configurar `expo-updates` para que la
app baje cambios JS/asset al volver a abrirla, sin reinstalar (siempre
que no se toquen módulos nativos).

---

## 7. Troubleshooting

- **"INSTALL_FAILED_INSUFFICIENT_STORAGE"** → el celular no tiene
  espacio. Liberá ~150MB.
- **"App not installed"** después de actualizar → seguramente
  `versionCode` no subió. Bumpealo y rebuild.
- **Crashea al abrir** después de instalar → mirá
  `eas build:view <id>` y revisá los logs. Lo más común es
  `EXPO_PUBLIC_API_URL` mal seteada o un módulo nativo faltante.
- **La APK pesa >100MB** → revisá si dejaste assets gigantes en
  `assets/`. EAS no comprime imágenes automáticamente.
- **Build falla con "Keystore not found"** → corré
  `eas credentials` y verificá que haya un Android keystore. Si no,
  generá uno: el flow interactivo te lleva.
