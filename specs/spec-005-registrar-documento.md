# spec-005 — Registrar un Documento con Vencimiento y adjunto

- **Bounded Context:** BC-4 Compliance & Documents (CORE)
- **Prioridad:** MVP
- **Estado:** Implemented
- **Aprobada por:** Luis (Product Manager + dominio) · 2026-06-25
- **Specs relacionadas:** spec-003 (Vehículo), spec-004 (Conductor), spec-006 (alertas y Semáforo), spec-007 (Renovación)

## Objetivo

Permitir registrar un **Documento** (SOAT, revisión técnico-mecánica, tarjeta de operación, Licencia, examen médico, póliza contractual/extracontractual) asociado a un sujeto (**Vehículo** o **Conductor**), con su **Tipo de documento**, su **Vencimiento** y un **adjunto** de soporte. El registro recalcula el **Estado de cumplimiento (Semáforo)** del sujeto. El catálogo de Tipos de documento es **configurable** por Tenant para absorber cambios normativos sin redeploy. Es el corazón del valor del producto.

## Actor(es)

- **Administrador/Owner** u **Operador**: registran y editan Documentos y configuran el catálogo.
- **Gestor de Planilla** / **Representante Legal** / **Dueño de Vehículo**: consultan (lectura) según alcance.
- **Sistema** (BC-4 Compliance & Documents): valida, almacena el adjunto aislado por Tenant y recalcula el Semáforo.

## Reglas de negocio

1. Un Documento siempre pertenece a un sujeto: un **Vehículo** o un **Conductor** (referencia tipada `SujetoRef`).
2. El Documento se registra contra un **Tipo de documento** del catálogo configurable del Tenant; el Tipo define a qué sujeto aplica (Vehículo/Conductor) y su regla de Vigencia.
3. El Documento requiere una fecha de **Vencimiento** válida.
4. La fecha de Vencimiento debe ser **posterior o igual** a la fecha de emisión del Documento.
5. El **adjunto** de soporte (PDF/imagen) se almacena en almacenamiento por objeto **aislado por Tenant** (prefijo `<tenant_id>/`); en la base solo se guarda la referencia y metadatos (uri, hash, tamaño).
6. **Invariante I2:** no puede existir más de un Documento **vigente** del mismo Tipo para el mismo sujeto; al registrar uno nuevo del mismo Tipo se entra al flujo de Renovación (spec-007).
7. **Invariante I1:** al registrar un Documento se **recalcula** el Estado de cumplimiento (Semáforo) del sujeto, derivándolo siempre del peor estado entre sus Documentos.
8. **Invariante I3:** un Documento requerido por el catálogo y ausente cuenta como **incumplimiento** (Semáforo en rojo), no como ausencia neutra.
9. Al registrar el Documento se emite el evento `DocumentoRegistrado { documentoId, sujetoRef, tipo, vencimiento }`.
10. El catálogo permite **agregar** y **desactivar** Tipos de documento; **Invariante I5:** un Tipo no puede eliminarse si existen Documentos vigentes que lo referencian (solo desactivarse).
11. Los datos del adjunto y del Documento están aislados por Tenant: nunca visibles para otra Empresa.

## Casos felices

- El Operador registra el SOAT del Vehículo "ABC123" con vencimiento "2026-12-31" y adjunta el PDF; el Semáforo del Vehículo se recalcula.

## Casos alternativos

- El Operador agrega al catálogo un nuevo Tipo de documento (p. ej. "Certificado de gases") y luego registra un Documento de ese Tipo.
- El Operador registra un Documento cuyo Vencimiento es hoy mismo: se acepta (la evaluación del Semáforo es responsabilidad de spec-006).

## Casos de error

- Se intenta registrar un Documento con Vencimiento anterior a la fecha de emisión: se rechaza.
- Se intenta registrar un segundo Documento **vigente** del mismo Tipo para el mismo sujeto: no se duplica; se redirige a Renovación.
- Se intenta registrar un Documento de un Tipo que no aplica al sujeto (p. ej. tarjeta de operación a un Conductor): se rechaza.
- Se intenta eliminar un Tipo de documento con Documentos vigentes que lo referencian: se rechaza (solo se puede desactivar).

## Criterios de aceptación (Gherkin)

```gherkin
# language: es
Característica: Registrar un Documento con Vencimiento y adjunto
  Como Operador de una Empresa
  Quiero registrar Documentos con su Vencimiento y soporte
  Para mantener el cumplimiento documental de Vehículos y Conductores

  Antecedentes:
    Dado que existe la Empresa "Transporte Duster SAS" como Tenant
    Y que un Usuario con rol "Operador" está autenticado en esa Empresa
    Y que existe el Vehículo con placa "ABC123"
    Y que el catálogo de Tipos de documento incluye "SOAT" aplicable a Vehículo

  Escenario: Registro exitoso de un Documento con adjunto
    Cuando el Operador registra un Documento de Tipo "SOAT" para el Vehículo "ABC123" con emisión "2025-12-31", vencimiento "2026-12-31" y adjunta el archivo "soat-2026.pdf"
    Entonces el Documento queda registrado para el Vehículo "ABC123"
    Y el adjunto se almacena bajo el prefijo del Tenant
    Y se recalcula el Estado de cumplimiento del Vehículo
    Y se emite el evento "DocumentoRegistrado" con el Tipo "SOAT" y vencimiento "2026-12-31"

  Escenario: Agregar un Tipo de documento al catálogo y registrar un Documento de ese Tipo
    Cuando el Operador agrega al catálogo el Tipo "Certificado de gases" aplicable a Vehículo
    Y registra un Documento de Tipo "Certificado de gases" para el Vehículo "ABC123" con vencimiento "2026-09-30"
    Entonces el Documento queda registrado
    Y se emite el evento "DocumentoRegistrado" con el Tipo "Certificado de gases"

  Escenario: Documento con Vencimiento igual a hoy se acepta
    Cuando el Operador registra un Documento de Tipo "SOAT" para el Vehículo "ABC123" con vencimiento igual a la fecha de hoy
    Entonces el Documento queda registrado
    Y la evaluación del Semáforo corresponde al cálculo de cumplimiento

  Escenario: Rechazo por Vencimiento anterior a la emisión
    Cuando el Operador registra un Documento de Tipo "SOAT" con emisión "2026-01-10" y vencimiento "2025-12-31"
    Entonces el registro se rechaza
    Y se informa que el Vencimiento no puede ser anterior a la emisión

  Escenario: No se permite un segundo Documento vigente del mismo Tipo
    Dado que el Vehículo "ABC123" ya tiene un Documento "SOAT" vigente con vencimiento "2026-12-31"
    Cuando el Operador intenta registrar otro Documento "SOAT" vigente para el Vehículo "ABC123"
    Entonces no se crea un segundo Documento vigente del mismo Tipo
    Y el sistema redirige al flujo de Renovación

  Escenario: Rechazo por Tipo que no aplica al sujeto
    Dado que existe el Conductor "Juan Pérez"
    Y que el Tipo "Tarjeta de operación" aplica solo a Vehículo
    Cuando el Operador intenta registrar un Documento "Tarjeta de operación" para el Conductor "Juan Pérez"
    Entonces el registro se rechaza por Tipo no aplicable al sujeto

  Escenario: No se puede eliminar un Tipo con Documentos vigentes
    Dado que existen Documentos vigentes de Tipo "SOAT"
    Cuando el Operador intenta eliminar el Tipo "SOAT" del catálogo
    Entonces la eliminación se rechaza
    Y solo se permite desactivar el Tipo "SOAT"

  Escenario: Aislamiento del adjunto entre Tenants
    Dado que la Empresa "Empresa A" tiene un Documento con adjunto
    Y que un Usuario está autenticado en la Empresa "Empresa B"
    Cuando el Usuario de "Empresa B" lista los Documentos de su Empresa
    Entonces no obtiene ningún Documento ni adjunto de "Empresa A"
```

## Nota de implementación — adjuntos (2026-07-06)

El gap de adjuntos (R5/R11) quedó **implementado end-to-end**:

- **Contrato**: `PUT /documentos/{id}/adjunto` (octet-stream, 204; 413 >5MB; 422 tipo
  no permitido) ya existía; se agregó **`GET /documentos/{id}/adjunto`** (200 con el
  Content-Type original; 404 sin documento o sin adjunto).
- **Aplicación**: puerto `AlmacenAdjuntos` (guardar/obtener bajo prefijo del tenant) +
  casos `SubirAdjunto`/`DescargarAdjunto` (`application/adjuntos.use-cases.ts`).
  Tipos permitidos: PDF/JPEG/PNG. La ref incluye hash del contenido (append-only):
  el histórico de renovaciones conserva su adjunto; la nueva vigencia arranca sin él.
- **Dominio**: `Documento.adjuntarSoporte(ref)` sobre la vigencia actual.
- **Infraestructura**: in-memory (dev/tests, como el resto del wiring) y
  `FsAlmacenAdjuntos` (`infrastructure/`, `FLEETSPECIAL_ADJUNTOS_DIR`, metadatos
  mime/tamaño/sha256 junto al binario, refs saneadas contra path traversal).
  S3/MinIO implementará el mismo puerto cuando toque.
- **Decisión R5**: los metadatos (hash/tamaño) viven en el ALMACÉN, no en la base —
  la base solo guarda `adjunto_ref` (columna ya existente). Ratificar si se quiere
  duplicarlos en la base para consulta.
- **Portal**: subir/reemplazar/ver en Documentos y en el detalle de vehículo/conductor.
- **Verificación**: adjuntos.spec 6 ✓ (casos de uso + FS + aislamiento R11) y
  adjuntos.e2e 8 ✓ por HTTP real (round-trip de bytes, 413, 422, 404, aislamiento
  de tenant, renovación