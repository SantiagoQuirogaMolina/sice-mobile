# SICE Mobile — App nativa para operadores de campo

App **Android** nativa (React Native + Expo) para gestores y asistentes que
capturan entregas en zonas con red intermitente o sin red.

La web (`sice-frontend`) sigue siendo la interfaz principal para coordinadores,
super_admins, digitadores y auditores. **Esta app es solo para campo.**

---

## Sprint 9.0 — Estado actual

✅ **Listo en este turno:**
- Scaffold completo Expo + TypeScript + expo-router
- Theme tokens (mismo design system que la web)
- API client con SecureStore para tokens (Bearer auth)
- Login funcional contra el backend SICE existente
- Auth guard por rol (solo gestor/asistente)
- Lista de eventos del operador
- Placeholder de detalle del evento

🔜 **Siguientes sprints:**
- Lista de beneficiarios con búsqueda offline (SQLite)
- Wizard de captura: firma manuscrita + foto del documento + GPS
- Sync queue offline confiable (sobrevive a reinicios, app cerrada, sin red)
- Registro de excepciones offline (con id temporal y reconciliación)
- Notas del operador
- Notificaciones push

---

## Setup en tu máquina (10 minutos)

### Pre-requisitos

- **Node.js 20+** ([descargar](https://nodejs.org/))
- **npm** (viene con Node)
- Un **celular Android** (no iPhone — la app es solo Android por ahora)
- Tu PC y el celular conectados a la **misma red WiFi** (o usar tunnel)

### 1. Instalar dependencias

```bash
cd sice-mobile
npm install
```

Esto baja Expo, RN, y todas las deps. Tarda 2-3 minutos la primera vez.

### 2. Configurar URL del backend (opcional)

Por default apunta al backend de Railway en producción. Si quieres apuntar
a tu backend local, crea un archivo `.env` en `sice-mobile/`:

```bash
EXPO_PUBLIC_API_URL=http://192.168.1.100:4000
# Reemplaza 192.168.1.100 con la IP de tu PC en la red WiFi
```

Para encontrar tu IP en Windows: `ipconfig` → "IPv4 Address" del adaptador WiFi.

### 3. Instalar Expo Go en tu celular

[Expo Go en Play Store](https://play.google.com/store/apps/details?id=host.exp.exponent) — gratis.

### 4. Arrancar el dev server

```bash
npm start
```

Verás un QR en la terminal y se abrirá una página web en localhost:8081.

### 5. Escanear el QR con Expo Go

Abre Expo Go en tu celular → "Scan QR code" → apunta al QR de la terminal.

La app se descarga al celular y se abre. La primera vez tarda ~30 segundos.
Después es instantáneo.

### 6. Probar el login

Usa las mismas credenciales que en la web:
- `gestor@entidad.com` / la contraseña que tengas
- O cualquier operador real de tu tenant

Después del login deberías ver la lista de eventos asignados.

---

## Workflow de desarrollo

### Cambios en el código

```
1. Yo (Claude) escribo código → git push
2. Tú: git pull en sice-mobile/
3. Si npm start ya está corriendo → hot reload automático en 2-3s
4. Si no, ejecuta npm start
5. Ves los cambios en tu celular sin tener que reinstalar nada
```

### Cuando pruebas con un operador real (sin Expo Go)

Genera un APK con EAS Build (cloud, ~15 min):

```bash
# Solo la primera vez:
npm install -g eas-cli
eas login

# Cada build:
npm run build:android
```

EAS te da un link de descarga. Lo abre el operador en su celular, instala
el APK, listo. No necesita Expo Go ni Node ni nada.

---

## Estructura del proyecto

```
sice-mobile/
├── app/                          # expo-router file-based routing
│   ├── _layout.tsx               # Root: hidrate auth + status bar
│   ├── index.tsx                 # Redirect según auth
│   ├── (auth)/
│   │   ├── _layout.tsx
│   │   └── login.tsx             # Login screen
│   └── (gestor)/                 # Grupo protegido (auth guard)
│       ├── _layout.tsx           # Verifica rol gestor/asistente
│       ├── index.tsx             # Lista de eventos
│       └── event/[id]/
│           └── index.tsx         # Detalle del evento (placeholder)
├── components/
│   ├── Button.tsx
│   ├── Input.tsx
│   └── Screen.tsx                # Wrapper SafeArea + bg
├── lib/
│   ├── api/
│   │   ├── client.ts             # Fetch con Bearer + timeout
│   │   └── services/
│   │       ├── auth.service.ts
│   │       └── events.service.ts
│   ├── stores/
│   │   └── auth-store.ts         # Zustand sin persist (tokens en SecureStore)
│   └── theme/
│       └── tokens.ts             # Colores, spacing, radii (espejo de la web)
├── assets/                       # Iconos, splash (poner manualmente)
├── app.json                      # Config Expo
├── package.json
└── tsconfig.json
```

---

## Decisiones arquitectónicas

| Decisión | Por qué |
|---|---|
| **expo-router** (file-based) | Mismo modelo que Next App Router → menos contexto switch |
| **expo-secure-store** para tokens | Hardware-backed Keychain en Android, no plain text |
| **Bearer auth** (no cookies) | RN no maneja cookies httpOnly bien |
| **zustand** sin persist | Tokens en SecureStore (separado), user se rehidrata vía /me |
| **expo-sqlite** (próximo sprint) | Local-first, transaccional, sobrevive reinicios |
| **NO NativeWind / Tailwind** | StyleSheet nativo es más rápido y predecible |
| **Solo Android por ahora** | iOS requiere Apple Developer ($99/año). Combita es Android-first |

---

## Cuando algo no funciona

### "Network request failed" al hacer login

- Verifica que el celular y la PC estén en la misma WiFi
- Verifica `EXPO_PUBLIC_API_URL` en `.env` o `app.json`
- Si usas el backend en local, asegúrate de que está corriendo (`npm run dev` en `sice-backend/`)
- Si usas Railway, debería funcionar sin config extra

### "Unable to resolve module ..."

```bash
rm -rf node_modules .expo
npm install
npm start --clear
```

### Login OK pero no veo eventos

- Verifica que tu usuario tenga rol `gestor` o `asistente`
- Verifica que el evento esté en estado `active`, `paused` o `draft`
- Verifica que el coordinador te haya asignado a un sector del evento

---

## Próximos pasos

1. Pruebas el scaffold (este sprint).
2. Confirmas que login + lista funcionan.
3. Decidimos: ¿seguimos con detalle del evento + SQLite la próxima semana?

Cualquier bug que encuentres, lo reportas y lo cazamos como con la web.
