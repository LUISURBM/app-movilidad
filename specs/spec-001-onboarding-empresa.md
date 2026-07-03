# spec-001 — Registro y onboarding de Empresa (Tenant) con primer Administrador

- **Bounded Context:** BC-1 Identity & Access
- **Prioridad:** MVP
- **Estado:** Implemented
- **Aprobada por:** Luis (Product Manager + dominio) · 2026-06-25
- **Specs relacionadas:** spec-002 (invitar usuarios y roles), spec-003 (registrar Vehículo), spec-013 (suscripción/plan)

## Objetivo

Permitir que un visitante registre una nueva **Empresa (Tenant)** de forma self-service, acepte la **política de tratamiento de datos (Habeas Data, Ley 1581/2012)** y quede creado junto a su **primer Usuario** con rol **Administrador/Owner**. Sin aceptación del tratamiento de datos no se crea el Tenant. El Tenant es la unidad de aislamiento: todo dato posterior pertenece a exactamente una Empresa.

## Actor(es)

- **Visitante** (futuro Administrador/Owner): persona que registra su operación de transporte (p. ej. el propietario de la Renault Duster).
- **Sistema** (BC-1 Identity & Access): crea Tenant, Usuario inicial y registra el consentimiento.

## Reglas de negocio

1. El registro exige correo, nombre/razón social de la Empresa y, opcionalmente, NIT (opcional en el MVP).
2. El correo debe verificarse mediante un enlace antes de activar el acceso (anti-typo, anti-spam).
3. La **aceptación de la política de tratamiento de datos** (Ley 1581/2012) es **obligatoria y previa** a la creación del Tenant: sin aceptación no se crea nada.
4. Al aceptar, se registra evidencia del consentimiento: fecha/hora, **versión** de la política aceptada e identificación del titular.
5. Al crear el Tenant se crea **un único** primer Usuario con rol **Administrador/Owner**, vinculado al proveedor de identidad.
6. Se crea una **Suscripción** inicial en plan **Free** (1 vehículo) por defecto (detalle en spec-013).
7. El correo de la Empresa debe ser único: no puede existir otro Tenant activo con el mismo correo de registro.
8. Todo dato del nuevo Tenant queda **aislado**: nunca es visible para otra Empresa.
9. Al completar el alta se emite el evento de dominio de alta de Usuario/Tenant (`UsuarioInvitado` / alta inicial) para disparar el onboarding.

## Casos felices

- Un visitante registra su Empresa, verifica el correo, acepta el tratamiento de datos y obtiene un Tenant activo con su Usuario Administrador y una Suscripción Free.

## Casos alternativos

- El visitante registra la Empresa sin NIT (campo opcional en MVP): el Tenant se crea igualmente.
- El visitante deja la verificación de correo a medias y la retoma más tarde con el mismo enlace vigente.

## Casos de error

- El visitante **no acepta** el tratamiento de datos: el Tenant no se crea.
- El correo ya pertenece a un Tenant activo: el registro se rechaza.
- El enlace de verificación de correo está vencido: se solicita reenvío.

## Criterios de aceptación (Gherkin)

```gherkin
# language: es
Característica: Registro y onboarding de una Empresa (Tenant) con su primer Administrador
  Como visitante que opera transporte especial
  Quiero registrar mi Empresa aceptando el tratamiento de datos
  Para obtener un Tenant aislado con mi Usuario Administrador

  Antecedentes:
    Dado que un visitante inicia el registro de una nueva Empresa

  Escenario: Onboarding exitoso con aceptación de tratamiento de datos
    Dado que el visitante ingresa el correo "duster@transporte.co" y la razón social "Transporte Duster SAS"
    Y verifica su correo mediante el enlace recibido
    Cuando acepta la política de tratamiento de datos versión "v1.0"
    Entonces se crea la Empresa "Transporte Duster SAS" como Tenant
    Y se crea un Usuario Administrador/Owner asociado al correo "duster@transporte.co"
    Y se registra el consentimiento con la fecha y la versión "v1.0"
    Y la Empresa queda con una Suscripción en plan "Free"

  Escenario: No se crea el Tenant si no se acepta el tratamiento de datos
    Dado que el visitante verificó su correo
    Cuando rechaza la política de tratamiento de datos
    Entonces no se crea ninguna Empresa
    Y no se crea ningún Usuario
    Y se informa que la aceptación del tratamiento de datos es obligatoria

  Escenario: Registro sin NIT (campo opcional en el MVP)
    Dado que el visitante ingresa el correo "flota@pyme.co" y la razón social "Flota Pyme SAS"
    Y no ingresa NIT
    Y verifica su correo
    Cuando acepta la política de tratamiento de datos versión "v1.0"
    Entonces se crea la Empresa "Flota Pyme SAS" como Tenant
    Y el primer Usuario tiene rol Administrador/Owner

  Escenario: Rechazo por correo ya registrado
    Dado que ya existe una Empresa activa con el correo "duster@transporte.co"
    Cuando un visitante intenta registrar otra Empresa con el correo "duster@transporte.co"
    Entonces el registro se rechaza
    Y se informa que el correo ya está en uso

  Escenario: Enlace de verificación de correo vencido
    Dado que el visitante recibió un enlace de verificación que ya venció
    Cuando intenta verificar su correo con ese enlace
    Entonces la verificación se rechaza
    Y se ofrece reenviar un nuevo enlace de verificación

  Escenario: Aislamiento del nuevo Tenant frente a otras Empresas
    Dado que existe la Empresa "Empresa A" como Tenant con sus datos
    Y se crea la Empresa "Empresa B" como Tenant
    Cuando un Usuario de "Empresa B" consulta los datos de su Empresa
    Entonces solo obtiene datos de "Empresa B"
    Y nunca obtiene datos de "Empresa A"
```

## Notas de implementación (2026-07-02)

Implementada en `backend/src/modules/identity-access` (BC-1). `POST /tenants` es público
(exento de auth en el middleware). Suite verde: unitarias derivadas de los Gherkin +
integración PGlite (UNIQUE del correo de registro, RLS de usuario). Decisiones tomadas al
implementar, **para ratificación del dominio**:

1. **Onboarding en un solo paso.** El contrato hace el alta en un único `POST /tenants`
   (empresa + administrador + `aceptaTratamientoDatos`). La **verificación de correo por
   enlace (R2)** y su expiración NO se modelan aún (el contrato no las expone); se difieren
   como flujo posterior. El consentimiento (R3) sí es obligatorio: sin él no se crea nada.
2. **NIT opcional.** Se respeta la regla R1/MVP (NIT opcional) aunque el `RegistrarTenantRequest`
   del OpenAPI lo marque `required`. *Alternativa abierta:* quitar `nit` de `required` en el contrato.
3. **Versión de la política.** El contrato no envía la versión aceptada; se registra la
   versión vigente del servidor (`v1.0`) como evidencia (R4).
4. **Suscripción Free (R6).** Se modela como `plan` en el Tenant (no un agregado Suscripción
   aparte; spec-013 lo profundizará).
5. **Evento.** Se emite `TenantCreado` (candidato a añadir al AsyncAPI junto a `UsuarioInvitado`).
