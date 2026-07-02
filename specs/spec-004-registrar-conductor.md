# spec-004 — Registrar un Conductor y su Licencia de conducción

- **Bounded Context:** BC-3 Driver Management
- **Prioridad:** MVP
- **Estado:** Approved
- **Aprobada por:** Luis (Product Manager + dominio) · 2026-06-25
- **Specs relacionadas:** spec-002 (invitar usuario Conductor), spec-005 (registrar Documento), spec-008 (asignar Conductor a Servicio), spec-009 (regla de oro)

## Objetivo

Permitir registrar un **Conductor** dentro de una **Empresa (Tenant)** con sus datos personales y su **Licencia de conducción** (categoría y fecha de vencimiento). El Conductor es sujeto de cumplimiento documental propio. Al registrarse, dispara la creación de su **Expediente de cumplimiento** en BC-4. El Conductor que opera la app móvil se vincula además a un **Usuario** de BC-1 con Rol Conductor (ver spec-002).

## Actor(es)

- **Administrador/Owner** u **Operador**: registran y editan Conductores.
- **Sistema** (BC-3 Driver Management): valida datos, registra la Licencia y emite eventos.

## Reglas de negocio

1. Solo los Roles Administrador/Owner u Operador pueden dar de alta un Conductor.
2. Datos mínimos del Conductor: nombre completo y documento de identidad.
3. La captura de datos personales del Conductor está sujeta a **Habeas Data**: solo se registran datos necesarios (minimización) y el Tenant es el Responsable del tratamiento.
4. La **Licencia de conducción** se registra con **categoría** y **fecha de vencimiento**; habilita una clase de vehículo.
5. La fecha de vencimiento de la Licencia se gestiona como un **Documento** en BC-4 (la Licencia es un Tipo de documento del sujeto Conductor).
6. Al registrar el Conductor se emite el evento `ConductorRegistrado { conductorId, usuarioId }`.
7. El registro del Conductor crea su **Expediente de cumplimiento** en BC-4 (vía evento); mientras falten Documentos requeridos, su Semáforo está en rojo.
8. El vínculo del Conductor con un **Usuario** (para la app móvil) es opcional al alta y se completa mediante la invitación de BC-1 (spec-002).
9. El documento de identidad del Conductor debe ser único dentro del Tenant.

## Casos felices

- El Operador registra al conductor "Juan Pérez" con cédula y su Licencia categoría "C1" con vencimiento "2027-03-15".

## Casos alternativos

- El Operador registra al Conductor sin vincular aún su Usuario; el vínculo se hace después por invitación (spec-002).
- El Operador registra al Conductor y de inmediato lo invita como Usuario con Rol Conductor.

## Casos de error

- Se intenta registrar un Conductor sin Licencia de conducción cuando el catálogo la marca como requerida: su Semáforo queda en rojo por documento requerido ausente.
- Se intenta registrar un Conductor con un documento de identidad ya existente en el Tenant: se rechaza.

## Criterios de aceptación (Gherkin)

```gherkin
# language: es
Característica: Registrar un Conductor y su Licencia de conducción
  Como Operador de una Empresa
  Quiero registrar un Conductor con su Licencia
  Para que sea sujeto de cumplimiento y pueda operar Servicios

  Antecedentes:
    Dado que existe la Empresa "Transporte Duster SAS" como Tenant
    Y que un Usuario con rol "Operador" está autenticado en esa Empresa

  Escenario: Alta exitosa de un Conductor con su Licencia
    Cuando el Operador registra al Conductor "Juan Pérez" con cédula "1098765432"
    Y registra su Licencia de conducción categoría "C1" con vencimiento "2027-03-15"
    Entonces el Conductor queda registrado en la Empresa "Transporte Duster SAS"
    Y se emite el evento "ConductorRegistrado"
    Y se crea su Expediente de cumplimiento
    Y la Licencia queda como Documento del Conductor con vencimiento "2027-03-15"

  Escenario: Alta del Conductor sin vincular aún su Usuario de la app
    Cuando el Operador registra al Conductor "Ana Gómez" con cédula "1102233445" sin vincular un Usuario
    Entonces el Conductor queda registrado
    Y queda pendiente vincular su Usuario mediante invitación

  Escenario: Alta del Conductor e invitación inmediata como Usuario
    Cuando el Operador registra al Conductor "Carlos Ruiz" con cédula "1099887766"
    Y lo invita como Usuario con rol "Conductor" al correo "carlos@duster.co"
    Entonces el Conductor queda registrado
    Y se emite el evento "UsuarioInvitado" con el rol "Conductor"

  Escenario: Conductor sin Licencia requerida queda con Semáforo en rojo
    Dado que el catálogo marca la "Licencia de conducción" como Documento requerido del Conductor
    Cuando el Operador registra al Conductor "Pedro Díaz" con cédula "1100112233" sin Licencia
    Entonces el Conductor queda registrado
    Y su Estado de cumplimiento queda en "Vencido" por Documento requerido ausente

  Escenario: Rechazo por documento de identidad duplicado en el Tenant
    Dado que ya existe un Conductor con cédula "1098765432" en la Empresa "Transporte Duster SAS"
    Cuando el Operador intenta registrar otro Conductor con cédula "1098765432"
    Entonces el registro se rechaza
    Y se informa que el documento de identidad ya existe en la Empresa

  Escenario: Minimización de datos personales (Habeas Data)
    Cuando el Operador registra al Conductor "Laura Mora"
    Entonces solo se solicitan los datos personales necesarios para su habilitación
    Y la Empresa actúa como Responsable del tratamiento de esos datos
```
