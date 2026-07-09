# Fase 3 — Spec Driven Development (Specs)

> **Objetivo de la fase:** convertir el dolor del negocio (Fase 1) y el modelo de dominio (Fase 2) en **especificaciones ejecutables** que son la **fuente de verdad** del producto. En Spec Driven Development (SDD), la spec no es documentación que se escribe "después": es el **contrato** del que **derivan el código, las pruebas y los contratos de API**. Los agentes IA (Fase 8) la consumen como entrada principal: el Backend implementa lo que la spec dice, QA automatiza sus escenarios Gherkin, y cualquier ambigüedad se resuelve **en la spec**, no en el código.

Cada spec describe **comportamiento**, no tecnología: no menciona NestJS, Drift ni endpoints concretos. Usa **exactamente** el lenguaje ubicuo de la [Fase 2](../docs/02-domain-driven-design.md) y respeta los **bounded contexts**, sus **invariantes** y sus **políticas**.

---

## 1. ¿Qué es SDD y por qué la spec manda?

- **La spec es la fuente de verdad ejecutable.** Define *qué* debe hacer el sistema con criterios verificables. El código es una *implementación* de la spec; las pruebas son una *comprobación* de la spec. Si el código y la spec discrepan, **la spec gana** (o se corrige explícitamente la spec).
- **De la spec derivan los demás artefactos:** los criterios Gherkin alimentan a **QA** (Fase 8) que los automatiza; las reglas de negocio guían al **Backend**; el comportamiento offline guía a **Mobile**; el contrato OpenAPI (Fase 5) se valida contra ellas.
- **Los agentes IA la consumen.** Una spec precisa, en lenguaje ubicuo y con escenarios Gherkin, es legible tanto por humanos como por agentes. Es el insumo del Business Analyst (que las escribe) y de QA (que las verifica).

---

## 2. Convención de specs (formato estándar)

**Todas** las specs siguen el mismo formato. Esto las hace predecibles para humanos y agentes.

### 2.1 Estructura obligatoria

Cada archivo `spec-NNN-<slug>.md` contiene, en este orden:

```
# spec-NNN — Título
- **Bounded Context:** (BC-N nombre)
- **Prioridad:** MVP | V1 | V2
- **Estado:** Draft | Approved | Implemented
- **Specs relacionadas:** (ids)
## Objetivo
## Actor(es)
## Reglas de negocio        (lista numerada, clara y verificable)
## Casos felices
## Casos alternativos
## Casos de error
## Criterios de aceptación (Gherkin)   (uno o varios bloques ```gherkin)
```

- **Reglas de negocio:** lista **numerada** para poder referenciarlas (p. ej. "regla 6"). Cada regla es verificable, sin prosa vaga. Cuando aplica, citan la **invariante** (I1–I5, S1–S5) o **política** (P1–P12) de la Fase 2 que materializan.
- **Casos felices / alternativos / de error:** enumeran en prosa breve los caminos que los escenarios Gherkin luego formalizan. El error y el límite son **ciudadanos de primera clase** (vencimiento exacto en el día, odómetro que decrece, choque de ventana, duplicado por reintento, tenant equivocado).
- **Criterios de aceptación (Gherkin):** uno o varios bloques ` ```gherkin `, **en español**, usando las keywords estándar de Gherkin en español (ver §2.4). Cada spec tiene **3–5 escenarios o más** cubriendo caso feliz, alternativo y de error; las specs offline incluyen además escenarios de **pérdida de conexión, reintento y duplicado**.

### 2.2 Nomenclatura `spec-NNN`

- Identificador **estable** `spec-NNN` (NNN con tres dígitos, p. ej. `spec-006`). El número **no se reutiliza** ni se reordena: una vez asignado, es permanente y citable desde el EDT, las pruebas y los commits.
- Nombre de archivo: `spec-NNN-<slug>.md`, con `<slug>` corto y descriptivo en español (p. ej. `spec-006-alertas-vencimiento-semaforo.md`).
- Los escenarios Gherkin se citan como `spec-NNN / "nombre del Escenario"` (así los referencia QA en sus suites).

### 2.3 Versionado y estados

- **Estado** declarado en el encabezado de cada spec:

  | Estado | Significado |
  |---|---|
  | **Draft** | En redacción/revisión. Puede cambiar. No es base de implementación firme. |
  | **Approved** | Revisada y aceptada por Product Manager + dominio. Base estable para implementar y automatizar. |
  | **Implemented** | Implementada y con sus escenarios Gherkin verdes en QA. Cambios posteriores requieren nueva revisión. |

- **Versionado:** las specs viven en control de versiones (git). Un cambio de comportamiento se hace **editando la spec primero** (con revisión), y de ahí se propaga a código y pruebas. El historial de git es el registro de versiones; cambios mayores se reflejan en el commit y, si procede, en una nota dentro de la spec.

### 2.4 Keywords Gherkin en español (válidas)

Las specs usan las keywords **oficiales de Gherkin en español**. Equivalencias usadas:

| Inglés | Español usado |
|---|---|
| `Feature` | `Característica` |
| `Background` | `Antecedentes` |
| `Scenario` | `Escenario` |
| `Scenario Outline` | `Esquema del escenario` |
| `Examples` | `Ejemplos` |
| `Given` | `Dado` / `Dada` / `Dados` / `Dadas` |
| `When` | `Cuando` |
| `Then` | `Entonces` |
| `And` | `Y` |
| `But` | `Pero` |

> Cada bloque empieza con el comentario `# language: es` para que las herramientas Gherkin (Cucumber/SpecFlow/behave) interpreten las keywords en español.

---

## 3. Índice de specs

| Id | Título | Bounded Context | Prioridad | Estado | Archivo |
|---|---|---|---|---|---|
| spec-001 | Registro y onboarding de Empresa (Tenant) con primer Administrador | BC-1 Identity & Access | MVP | Implemented | [spec-001-onboarding-empresa.md](spec-001-onboarding-empresa.md) |
| spec-002 | Invitar usuarios y asignar roles dentro del Tenant | BC-1 Identity & Access | MVP | Implemented | [spec-002-invitar-usuarios-roles.md](spec-002-invitar-usuarios-roles.md) |
| spec-003 | Registrar un Vehículo (placa única por Tenant, odómetro monótono) | BC-2 Fleet Management | MVP | Implemented | [spec-003-registrar-vehiculo.md](spec-003-registrar-vehiculo.md) |
| spec-004 | Registrar un Conductor y su Licencia de conducción | BC-3 Driver Management | MVP | Implemented | [spec-004-registrar-conductor.md](spec-004-registrar-conductor.md) |
| spec-005 | Registrar un Documento con Vencimiento y adjunto | BC-4 Compliance & Documents (CORE) | MVP | Implemented | [spec-005-registrar-documento.md](spec-005-registrar-documento.md) |
| spec-006 | Alertas anticipadas de Vencimiento (30/15/3 días) y cálculo del Semáforo | BC-4 Compliance & Documents (CORE) | MVP | Implemented | [spec-006-alertas-vencimiento-semaforo.md](spec-006-alertas-vencimiento-semaforo.md) |
| spec-007 | Renovación de un Documento con histórico | BC-4 Compliance & Documents (CORE) | MVP | Implemented | [spec-007-renovacion-documento.md](spec-007-renovacion-documento.md) |
| spec-008 | Crear un Servicio y asignar Vehículo + Conductor (choques de Ventana horaria) | BC-5 Service Scheduling (CORE) | MVP | Implemented | [spec-008-crear-servicio-asignacion.md](spec-008-crear-servicio-asignacion.md) |
| spec-009 | Regla de oro: bloquear Asignación si el recurso no está al día (Semáforo rojo) | BC-5 Service Scheduling (CORE) + BC-4 vía ACL | MVP | Implemented | [spec-009-regla-de-oro-bloqueo-asignacion.md](spec-009-regla-de-oro-bloqueo-asignacion.md) |
| spec-010 | El Conductor ejecuta su Servicio OFFLINE (mi día, iniciar/finalizar, sincronizar) | BC-5 Service Scheduling (CORE), offline | MVP | Implemented | [spec-010-conductor-ejecuta-servicio-offline.md](spec-010-conductor-ejecuta-servicio-offline.md) |
| spec-011 | Registrar Tanqueo (combustible) OFFLINE append-only con idempotencia | BC-6 Fuel Management, offline | MVP | Implemented | [spec-011-tanqueo-offline-append-only.md](spec-011-tanqueo-offline-append-only.md) |
| spec-012 | Programar Mantenimiento preventivo por Umbral de Odómetro/fecha | BC-7 Maintenance Management | MVP | Implemented | [spec-012-mantenimiento-preventivo-umbral.md](spec-012-mantenimiento-preventivo-umbral.md) |
| spec-013 | Gestión de Suscripción y Plan (vehículos activos, límites, entitlements) | BC-8 Billing & Subscriptions | V1 | Draft | [spec-013-gestion-suscripcion-plan.md](spec-013-gestion-suscripcion-plan.md) |
| spec-014 | Registrar una Novedad OFFLINE con foto (append-only) | BC-5 Service Scheduling (CORE), offline | MVP | Implemented | [spec-014-novedad-offline-con-foto.md](spec-014-novedad-offline-con-foto.md) |
| spec-015 | Autenticación con credenciales (login de correo y contraseña) | BC-1 Identity & Access | MVP | Implemented | [spec-015-autenticacion-credenciales.md](spec-015-autenticacion-credenciales.md) |

> **Prioridades:** **MVP** = entra al dogfooding con la Duster (Fase 1 §5). **V1** = comercializable (self-service + cobro). **V2** = upsells diferidos (GPS live, DIAN). spec-013 es V1 porque la gestión de planes/cobro pertenece a la fase comercializable; el onboarding del MVP (spec-001) solo crea la Suscripción Free por defecto.

---

## 4. Trazabilidad

### 4.1 Spec → Bounded Context (Fase 2) → Caso de uso (Fase 1)

Cada spec nace de un caso de uso del MVP (Fase 1 §4, los marcados ⭐) y vive en un bounded context (Fase 2 §2).

| Spec | Bounded Context (Fase 2) | Caso de uso (Fase 1 §4) | Invariantes / Políticas (Fase 2) |
|---|---|---|---|
| spec-001 | BC-1 Identity & Access | Operar bajo una empresa (tenant) con datos aislados ⭐ | Aislamiento por tenant; consentimiento Habeas Data |
| spec-002 | BC-1 Identity & Access | Invitar usuarios y asignar roles ⭐ | Evento `UsuarioInvitado` |
| spec-003 | BC-2 Fleet Management | Dar de alta un vehículo ⭐ | Placa única por tenant; odómetro monótono; `VehiculoRegistrado`, `VehiculoAfiliado` |
| spec-004 | BC-3 Driver Management | Dar de alta un conductor y su licencia ⭐ | `ConductorRegistrado`; Habeas Data |
| spec-005 | BC-4 Compliance & Documents | Registrar un documento con vencimiento y adjunto ⭐ | I1, I2, I3, I5; `DocumentoRegistrado` |
| spec-006 | BC-4 Compliance & Documents | Alerta anticipada de vencimiento ⭐ + semáforo ⭐ | I1, I3; P1, P2; `DocumentoPorVencer`, `DocumentoVencido` |
| spec-007 | BC-4 Compliance & Documents | Renovar un documento con histórico | I2, I4; P5; `DocumentoRenovado` |
| spec-008 | BC-5 Service Scheduling | Crear servicio y asignar; detectar choques ⭐ | S1, S2, S4; P4, P10; `ServicioCreado`, `ServicioAsignado`, `AsignacionRechazada` |
| spec-009 | BC-5 Service Scheduling + BC-4 (ACL) | Asignar vehículo+conductor (regla de oro) ⭐ | S3; P3, P11, P5; `AsignacionRechazada` |
| spec-010 | BC-5 Service Scheduling (offline) | El conductor ve su servicio offline y lo marca iniciado/finalizado ⭐ | S1, S2, S5; P8, P12; `ServicioIniciado`, `ServicioFinalizado` |
| spec-011 | BC-6 Fuel Management (offline) | Registrar una carga de combustible offline ⭐ | P6, P8, P12; `CombustibleRegistrado`, `OdometroActualizado` |
| spec-012 | BC-7 Maintenance Management | Registrar/programar mantenimiento preventivo ⭐ | Umbral; P6, P7; `MantenimientoProgramado`, `MantenimientoVencido`, `MantenimientoRegistrado` |
| spec-013 | BC-8 Billing & Subscriptions | Gestionar suscripción y plan (post-MVP temprano) | P9; `SuscripcionActivada` |
| spec-014 | BC-5 Service Scheduling (offline) | Registrar novedades con foto que sincronizan ⭐ | S5; P12; `NovedadReportada` |
| spec-015 | BC-1 Identity & Access | Login con correo/contraseña; invitación con código de un solo uso ⭐ | scrypt; JWT HS256; credencial/invitación pre-tenant |

### 4.2 Conexión con las demás fases

- **EDT / WBS (Fase 4):** cada spec `Approved` se descompone en epics y subtasks estimables. La unidad de trabajo se referencia por `spec-NNN`, de modo que el EDT hereda la prioridad (MVP/V1/V2) y el bounded context de la spec. Una spec sin descomponer en el EDT es trabajo no planificado.
- **Arquitectura y contratos (Fase 5):** las reglas de negocio de cada spec guían el contrato **OpenAPI**; las pruebas de contrato validan que la API cumple lo que la spec exige.
- **Offline-first (Fase 6) y multi-tenant (Fase 7):** las specs offline (010, 011, 014) materializan la clasificación A/B/C y la idempotencia; los escenarios de aislamiento de cada spec materializan el `tenant_id` + RLS.
- **QA (Fase 8):** **cada Escenario Gherkin de una spec es un caso de prueba.** QA traduce los criterios de aceptación en pruebas automatizadas (unitarias, integración, contrato, e2e) trazables al `spec-NNN`. Un entregable no está "probado" si quedan escenarios de su spec sin cubrir — incluidos los de error, límite, offline y aislamiento.

---

## 5. Cómo leer una spec (ejemplo anotado)

Tomando `spec-006` como ejemplo:

```
# spec-006 — Alertas anticipadas de Vencimiento (30/15/3 días) y cálculo del Semáforo
- Bounded Context: BC-4 Compliance & Documents (CORE)   ← dónde vive (Fase 2)
- Prioridad: MVP                                         ← entra al dogfooding
- Estado: Implemented                                    ← construida y con Gherkin en verde
```

- El **encabezado** te dice de un vistazo el contexto, la prioridad y la madurez.
- En **Reglas de negocio**, la regla 3 ("vence hoy → amarillo, aún no rojo") es un **caso límite** explícito: así QA sabe que debe probar el día exacto del vencimiento. La regla 4 cita la **política P1** de la Fase 2: la spec no inventa, materializa el modelo.
- En **Criterios de aceptación**, el `Esquema del escenario` con `Ejemplos` recorre la tabla de umbrales (45/30/15/3/0/-1/-10 días). Cada fila es un caso de prueba parametrizado:

```gherkin
# language: es
Esquema del escenario: Estado del Documento según días restantes
  Dado que el Vehículo "ABC123" tiene un Documento "SOAT" que vence en <dias> días
  Cuando el reloj de dominio evalúa los Vencimientos
  Entonces el estado del Documento es "<estado>"
  Ejemplos:
    | dias | estado     |
    | 0    | Por vencer |   ← caso límite: vence hoy, todavía amarillo
    | -1   | Vencido    |   ← venció ayer, ya rojo
```

- Para **leerla como agente o QA:** cada `Escenario`/fila de `Ejemplos` se convierte en una verificación; el `Dado` arma el estado, el `Cuando` ejecuta la acción, el `Entonces` afirma el resultado esperado. El lenguaje ubicuo (Vencimiento, Semáforo, Documento) es **idéntico** al del código y la UI.

> **Regla de oro del negocio (recordatorio transversal):** *no se puede asignar un Servicio a un Vehículo o Conductor