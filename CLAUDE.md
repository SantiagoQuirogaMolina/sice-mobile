# SICE Mobile — Contexto

> El contexto canónico vive en `../sice-frontend/CLAUDE.md`. Este archivo
> es solo un puntero + notas específicas del mobile.

---

## Lectura obligatoria al iniciar sesión

1. `../sice-frontend/CLAUDE.md` — arquitectura, roles, stack, reglas estrictas
2. `../sice-frontend/PLAN.md` — estado actual y próximo paso

---

## Específico de este repo

### Stack
- Expo SDK 54 + React Native 0.81
- expo-router (file-based)
- expo-sqlite (cache offline)
- expo-secure-store (tokens + user)
- expo-camera + react-native-signature-canvas + expo-location
- Android 7+ (minSdk 24, target 36)

### App es SOLO para gestor
No para coordinator/super_admin. Esos van por web.
Los chips de login en la APK muestran solo gestores demo.

### Comandos clave
```bash
npx tsc --noEmit              # typecheck
npm start                     # Metro (desarrollo con Expo Go)
npx expo prebuild --platform android   # generar android/ si no existe
```

### Build APK release (sin EAS)
```bash
cd android
JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-17.0.19.10-hotspot" \
PATH="/c/Program Files/Eclipse Adoptium/jdk-17.0.19.10-hotspot/bin:$PATH" \
ANDROID_HOME="/c/Users/pc/AppData/Local/Android/Sdk" \
./gradlew assembleRelease
```
- Requiere JDK 17 (no 15, no 21)
- Usa el debug keystore para firmar (configurado en `app/build.gradle`)
- Resultado: `android/app/build/outputs/apk/release/app-release.apk` (~105 MB)
- Tarda ~1-2 min en builds incrementales, ~12 min en clean

### Offline-first
- Cada pantalla del gestor lee del cache SQLite ANTES de pedir al backend
- Si la red falla → banner "Modo offline" cyan, no error rojo
- Captura siempre va a tablas `pending_*`, sync queue las sube
- Auto-sync se dispara después de cada `enqueueDelivery` /
  `registerExceptionOffline` (Sprint 9.10) — no es necesario tocar Sync
  manualmente si hay red

### Tablas SQLite clave
```
cached_events             # eventos descargados
cached_beneficiaries      # lista del evento (incluye pending locales)
pending_citizens          # citizens creados offline
pending_event_beneficiaries # EBs offline
pending_deliveries        # deliveries offline
```

### Sync queue (`lib/sync/queue.ts`)
- `processSyncQueue()` corre 3 stages: citizens → EBs → deliveries
- Dependencia: EB necesita citizen.serverId; delivery puede usar
  citizen local o server según contexto
- Mutex `inFlight` previene 2 corridas paralelas
- Items en estado `blocked` SE REINTENTAN (Sprint 9.10) — antes no
- Stuck recovery: items en `syncing` >60s se resetean a `pending`

### Convenciones
- Estados de pending: `pending | syncing | synced | error | blocked`
- Backoff: error retryable usa exponencial; non-retryable → blocked
- 409 conflict del backend → blocked (Sprint 9.10: el backend ya no
  los emite porque es idempotente, pero el código mobile aún los maneja)

### KeyboardAvoidingView (Sprint 9.10)
- En forms con muchos inputs: `behavior="padding"` en ambas plataformas
- `keyboardVerticalOffset: 24` en Android
- ScrollView con `paddingBottom: 320` para no quedarse sin espacio
- AndroidManifest tiene `windowSoftInputMode="adjustResize"` — NO QUITAR
