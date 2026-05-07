# SICE Mobile — Plan

> El estado canónico vive en `../sice-frontend/PLAN.md`.

**Último commit:** `cec2a81` — auto-sync online + cache preserva pending
**Tag de checkpoint:** `checkpoint-2026-05-06-tipo-b-volume`
**APK actual entregada:** `C:\Users\pc\Desktop\sice-operador-2026-05-06-v8.apk`

## Recientes (Sprint 9.10)

- `cec2a81` — auto-sync online + preservar pending en refresh
- `15af61d` — sync queue reintenta items 'blocked'
- `c4e276d` — emit batch-end siempre (no se queda en spinner)
- `3851329` — teclado no tapa inputs + Tipo B sin sector ni zona
- `1188d31` — offline-first inicio + Tipo B form `/event/[id]/new`
- `919504d` — chips demo de gestores en login
- `df582ba` — fechas, orden y estado completado en lista
- `a6ae604` — Tipo B copy "Añadir registro" / "Ver lista de registros"

## Pendiente

- Validar PDF con foto/firma reales (después de capturar UNA entrega
  nueva con APK v8 en el Railway Volume)
- Ver lista de pendientes generales en `../sice-frontend/PLAN.md`

## Para una nueva sesión

Si el bug está en mobile:
1. Lee `CLAUDE.md` de este repo + el canónico (`../sice-frontend/`)
2. `lib/sync/queue.ts` — orquesta sync
3. `lib/sync/transport.ts` — uploads HTTP
4. `lib/offline/db.ts` — toda la lógica SQLite
5. `app/(gestor)/event/[id]/` — flow de captura
