# Demo con APK en el teléfono — runbook

Objetivo: mostrar a socios el flujo estrella en un teléfono real:
**"mi día" → modo avión → iniciar/finalizar offline → volver la señal → todo
sincroniza sin perder ni duplicar** (+ la regla de oro viva en el semáforo).

Requisitos en tu PC: Flutter SDK, Node/pnpm, teléfono Android con
"instalar apps de origen desconocido" y **en la MISMA red WiFi que el PC**.

## 1) Backend con JWT (una terminal)

```powershell
cd backend
$env:FLEETSPECIAL_JWT_SECRET = "demo-secreto-largo-y-unico-2026"
pnpm install
pnpm start:dev     # queda en http://0.0.0.0:3000/v1
```

> La base es in-memory: si reinicias el backend, vuelve a correr el seed (paso 3).

## 2) Tokens (otra terminal, mismo secreto)

```powershell
cd backend
$env:FLEETSPECIAL_JWT_SECRET = "demo-secreto-largo-y-unico-2026"
npx tsx tool/token-dev.ts --tenant tenant-demo --sub admin-luis --roles Operador --horas 24
npx tsx tool/token-dev.ts --tenant tenant-demo --sub cond-luis  --roles Conductor --horas 24
```

Guarda los dos tokens: el de **Operador** para el seed, el de **Conductor**
para pegarlo en la app.

## 3) Datos del demo

```powershell
npx tsx tool/seed-demo.ts --url http://localhost:3000/v1 --token <TOKEN-OPERADOR>
```

Crea: catálogo SOAT → SOAT vigente del vehículo `veh-duster` → 2 servicios de
hoy asignados a `cond-luis` (la regla de oro pasa en verde).

## 4) APK

```powershell
cd mobile\fleetspecial_app
flutter create . --platforms android    # solo la primera vez (genera android/)
flutter pub get
dart run build_runner build             # genera base_local.g.dart
flutter test                            # opcional: la misma suite del CI
flutter build apk --debug               # DEBUG: permite http:// sin config extra
```

APK en `build\app\outputs\flutter-apk\app-debug.apk` → pásalo al teléfono
(cable/Drive/WhatsApp) e instálalo.

> ¿APK release? Requiere permitir HTTP claro hacia tu PC: en
> `android/app/src/main/AndroidManifest.xml`, dentro de `<application ...>`
> agrega `android:usesCleartextTraffic="true"`. Para el demo, debug basta.

## 5) Conectar la app

1. Averigua la IP LAN de tu PC: `ipconfig` → IPv4 (p. ej. `192.168.1.10`).
2. Permite el puerto si Windows pregunta (firewall) la primera vez.
3. En la app: URL `http://192.168.1.10:3000/v1` + pega el **token de Conductor**.
4. "Mi día" → desliza hacia abajo: aparecen los 2 servicios y el semáforo verde.

## 6) Guion del demo (5 minutos)

1. **Semáforo vivo:** muestra "Vehículo al día" con el SOAT y sus días.
2. **Modo avión.** La app sigue mostrando todo + "datos de hace N min".
3. **Iniciar** el servicio de la mañana con odómetro (¡sin señal!): confirma al
   instante, badge "1 por subir".
4. **Finalizar** con odómetro: badge "2 por subir". *"El conductor nunca espera
   a la red."*
5. **Quitar modo avión** → en segundos el badge desaparece: sincronizó.
6. Prueba de fe en el PC: 
   `curl http://localhost:3000/v1/servicios -H "Authorization: Bearer <TOKEN-OPERADOR>"`
   → el servicio está `Finalizado` con los odómetros del teléfono.
7. Remate (regla de oro): registra un documento vencido a otro vehículo e
   intenta asignarle un servicio → `409 incumplimiento`. *"El sistema no deja
   despachar un vehículo ilegal."*

## Problemas típicos

| Síntoma | Causa probable | Arreglo |
|---|---|---|
| App: "Aún sin sincronizar" eterno | Teléfono no alcanza el PC | Misma WiFi; probar `http://IP:3000/v1/health` en el navegador del teléfono |
| 401 al sincronizar | Token de otro secreto o vencido | Regenerar token con el MISMO secreto del backend |
| Lista vacía tras refrescar | Seed corrió contra otro tenant/conductor | Usar `--tenant tenant-demo` y app con token `sub=cond-luis` |
| El backend "olvidó" los datos | Reinicio (in-memory) | Correr de nuevo el seed |
