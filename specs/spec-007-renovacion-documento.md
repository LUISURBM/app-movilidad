# spec-007 — Renovación de un Documento con histórico

- **Bounded Context:** BC-4 Compliance & Documents (CORE)
- **Prioridad:** MVP
- **Estado:** Approved
- **Aprobada por:** Luis (Product Manager + dominio) · 2026-06-25
- **Specs relacionadas:** spec-005 (registrar Documento), spec-006 (alertas y Semáforo), spec-009 (regla de oro — rehabilitación)

## Objetivo

Permitir **renovar** un **Documento** por vencer o vencido, sustituyéndolo por una nueva versión vigente y **conservando el histórico** de versiones anteriores como registros inmutables. Al renovar, el sujeto recalcula su **Semáforo** y, si vuelve a estar **Vigente**, se **rehabilita** para ser asignado a Servicios (Política P5).

## Actor(es)

- **Administrador/Owner** u **Operador**: ejecutan la Renovación.
- **Sistema** (BC-4 Compliance & Documents): archiva la versión anterior, crea la nueva versión vigente, recalcula el Semáforo y emite eventos.

## Reglas de negocio

1. La Renovación parte de un Documento existente del mismo **Tipo** y mismo **sujeto** (Vehículo o Conductor).
2. La nueva versión requiere una **nueva fecha de Vencimiento** y un nuevo adjunto de soporte.
3. **Invariante I4:** la nueva Vigencia debe ser **posterior** a la fecha de emisión de la nueva versión; la versión anterior se conserva como **histórico inmutable**.
4. **Invariante I2:** tras la Renovación queda **exactamente un** Documento **vigente** del Tipo para el sujeto; las versiones anteriores quedan marcadas como histórico (no vigentes).
5. El histórico **nunca se borra ni se altera**: queda consultable con su Vencimiento y adjunto originales.
6. Tras la Renovación se **recalcula** el Estado de cumplimiento del sujeto (Invariante I1).
7. Al renovar se emite el evento `DocumentoRenovado { documentoId, nuevoVencimiento, versionAnterior }`.
8. **Política P5 — rehabilitación:** si la Renovación devuelve el sujeto a **Vigente**, se levanta el bloqueo de asignaciones futuras para ese recurso (Service Scheduling reacciona — spec-009).
9. Se puede renovar un Documento **antes** de vencer (estando Por vencer) o **después** de vencido; en ambos casos se conserva la versión anterior.
10. La Renovación respeta el aislamiento por Tenant: solo opera sobre Documentos de la propia Empresa.

## Casos felices

- El Operador renueva el SOAT del Vehículo "ABC123" (que estaba por vencer) con un nuevo Vencimiento "2027-12-31"; el anterior pasa a histórico y el Semáforo vuelve a verde.

## Casos alternativos

- Se renueva un Documento ya **vencido**: el sujeto pasa de rojo a verde y se rehabilita para asignaciones.
- Se renueva un Documento estando **por vencer**: el Semáforo vuelve a verde antes de llegar a rojo.

## Casos de error

- Se intenta renovar con una nueva Vigencia anterior a la fecha de emisión de la nueva versión: se rechaza.
- Se intenta alterar o borrar una versión histórica: la operación se rechaza (histórico inmutable).

## Criterios de aceptación (Gherkin)

```gherkin
# language: es
Característica: Renovación de un Documento con histórico
  Como Operador de una Empresa
  Quiero renovar un Documento conservando sus versiones anteriores
  Para mantener el cumplimiento al día sin perder la trazabilidad histórica

  Antecedentes:
    Dado que existe la Empresa "Transporte Duster SAS" como Tenant
    Y que un Usuario con rol "Operador" está autenticado en esa Empresa
    Y que existe el Vehículo con placa "ABC123"

  Escenario: Renovación exitosa de un Documento por vencer
    Dado que el Vehículo "ABC123" tiene un Documento "SOAT" vigente que vence en 10 días
    Cuando el Operador renueva el "SOAT" con emisión "2026-12-15", nuevo vencimiento "2027-12-31" y adjunta "soat-2027.pdf"
    Entonces existe exactamente un Documento "SOAT" vigente con vencimiento "2027-12-31"
    Y la versión anterior queda como histórico inmutable
    Y se recalcula el Estado de cumplimiento del Vehículo a "Vigente"
    Y se emite el evento "DocumentoRenovado" con el nuevo vencimiento "2027-12-31"

  Escenario: Renovación de un Documento vencido rehabilita el recurso
    Dado que el Vehículo "ABC123" tiene un Documento "SOAT" vencido y su Estado de cumplimiento es "Vencido"
    Cuando el Operador renueva el "SOAT" con nuevo vencimiento "2027-12-31"
    Entonces el Estado de cumplimiento del Vehículo pasa a "Vigente"
    Y se levanta el bloqueo de asignaciones futuras para el Vehículo "ABC123"
    Y se emite el evento "DocumentoRenovado"

  Escenario: El histórico conserva la versión anterior
    Dado que el Vehículo "ABC123" tiene un Documento "SOAT" con vencimiento "2026-12-31"
    Cuando el Operador renueva el "SOAT" con nuevo vencimiento "2027-12-31"
    Entonces la versión con vencimiento "2026-12-31" se conserva en el histórico
    Y la versión histórica mantiene su adjunto original

  Escenario: Solo queda un Documento vigente del Tipo tras la Renovación
    Dado que el Vehículo "ABC123" tiene un Documento "SOAT" vigente
    Cuando el Operador renueva el "SOAT"
    Entonces existe exactamente un Documento "SOAT" vigente para el Vehículo "ABC123"
    Y las versiones anteriores no están vigentes

  Escenario: Rechazo por nueva Vigencia anterior a la emisión
    Dado que el Vehículo "ABC123" tiene un Documento "SOAT"
    Cuando el Operador intenta renovar el "SOAT" con emisión "2027-01-10" y nuevo vencimiento "2026-12-31"
    Entonces la Renovación se rechaza
    Y se informa que la nueva Vigencia no puede ser anterior a la emisión

  Escenario: No se puede alterar una versión histórica
    Dado que el Vehículo "ABC123" tiene una versión histórica de "SOAT" con vencimiento "2025-12-31"
    Cuando se intenta modificar o borrar esa versión histórica
    Entonces la operación se rechaza por ser el histórico inmutable
```
