# spec-006 — Alertas anticipadas de Vencimiento (30/15/3 días) y cálculo del Semáforo

- **Bounded Context:** BC-4 Compliance & Documents (CORE)
- **Prioridad:** MVP
- **Estado:** Approved
- **Aprobada por:** Luis (Product Manager + dominio) · 2026-06-25
- **Specs relacionadas:** spec-005 (registrar Documento), spec-007 (Renovación), spec-009 (regla de oro)

## Objetivo

Calcular el **Estado de cumplimiento (Semáforo)** de un Vehículo o Conductor a partir de los **Vencimientos** de sus **Documentos**, y emitir **alertas anticipadas** cuando un Documento queda a **30, 15 o 3 días** de su Vencimiento. El Semáforo toma tres valores: **Vigente (verde)**, **Por vencer (amarillo)** y **Vencido (rojo)**, derivados del peor estado entre los Documentos del sujeto. Es el dolor #1 validado: evitar vencimientos sorpresa.

## Actor(es)

- **Sistema** (BC-4, reloj de dominio): evalúa Vencimientos a diario y emite eventos de alerta.
- **Administrador/Owner**, **Operador**, **Dueño de Vehículo**: reciben alertas y consultan el Semáforo.
- **Service Scheduling (BC-5)**: consume `DocumentoPorVencer` (advierte) y `DocumentoVencido` (bloquea — ver spec-009).

## Reglas de negocio

1. El **Semáforo** del sujeto se calcula como el **peor estado** entre todos sus Documentos requeridos/vigentes (Invariante I1).
2. Estados del Documento por días restantes hasta el Vencimiento:
   - **Vigente (verde):** faltan más de 30 días.
   - **Por vencer (amarillo):** faltan 30 días o menos (y el Documento aún no ha vencido).
   - **Vencido (rojo):** la fecha actual **supera** el Vencimiento (días restantes negativos).
3. **Caso límite — vence hoy:** si la fecha actual es **igual** al Vencimiento (0 días restantes), el Documento está **Por vencer (amarillo)**, todavía no Vencido. Pasa a Vencido el día siguiente.
4. Las **alertas anticipadas** se emiten exactamente a **30, 15 y 3 días** restantes mediante el evento `DocumentoPorVencer { documentoId, sujetoRef, tipo, diasRestantes }` (Política P1).
5. Cada umbral de alerta (30/15/3) se notifica **una sola vez** por Documento al cruzarlo (no se repite a diario dentro del mismo umbral).
6. Cuando la fecha actual supera el Vencimiento, se emite `DocumentoVencido { documentoId, sujetoRef, tipo }`, el Semáforo del sujeto pasa a rojo y se recalcula (Política P2).
7. **Invariante I3:** un Documento requerido por el catálogo y **ausente** cuenta como **Vencido (rojo)**, no como ausencia neutra.
8. La evaluación de Vencimientos corre como un **chequeo diario** del reloj de dominio (no requiere acción del usuario).
9. El Semáforo de un Vehículo y el de un Conductor se calculan de forma **independiente** (cada uno por sus propios Documentos).
10. Todos los eventos llevan `tenantId` implícito; las alertas de un Tenant nunca se mezclan con otro.

## Casos felices

- Un SOAT con 45 días restantes mantiene el Semáforo del Vehículo en verde, sin alertas.
- Un SOAT que cruza el umbral de 30 días emite una alerta `DocumentoPorVencer(30)` y pone el Semáforo en amarillo.

## Casos alternativos

- Un Vehículo con SOAT verde pero RTM en amarillo: su Semáforo es **amarillo** (peor estado).
- Un Documento cruza sucesivamente 30, 15 y 3 días: emite tres alertas, una por umbral.

## Casos de error / límite

- Documento que **vence hoy** (0 días): estado amarillo (Por vencer), aún no rojo.
- Documento que venció ayer (-1 día): estado rojo (Vencido); se emite `DocumentoVencido`.
- Documento requerido **ausente**: Semáforo rojo aunque ningún Documento exista para ese Tipo.

## Criterios de aceptación (Gherkin)

```gherkin
# language: es
Característica: Alertas anticipadas de Vencimiento y cálculo del Semáforo
  Como Operador de una Empresa
  Quiero recibir alertas anticipadas y ver el Semáforo de cumplimiento
  Para evitar que un Vehículo o Conductor opere con Documentos vencidos

  Antecedentes:
    Dado que existe la Empresa "Transporte Duster SAS" como Tenant
    Y que existe el Vehículo con placa "ABC123"

  Esquema del escenario: Estado del Documento según días restantes
    Dado que el Vehículo "ABC123" tiene un Documento "SOAT" que vence en <dias> días
    Cuando el reloj de dominio evalúa los Vencimientos
    Entonces el estado del Documento es "<estado>"
    Y el Estado de cumplimiento del Vehículo es "<semaforo>"

    Ejemplos:
      | dias | estado     | semaforo   |
      | 45   | Vigente    | Vigente    |
      | 30   | Por vencer | Por vencer |
      | 15   | Por vencer | Por vencer |
      | 3    | Por vencer | Por vencer |
      | 0    | Por vencer | Por vencer |
      | -1   | Vencido    | Vencido    |
      | -10  | Vencido    | Vencido    |

  Esquema del escenario: Emisión de alerta anticipada por umbral
    Dado que el Vehículo "ABC123" tiene un Documento "SOAT" que vence en <dias> días
    Cuando el reloj de dominio evalúa los Vencimientos
    Entonces se emite el evento "DocumentoPorVencer" con diasRestantes <dias>

    Ejemplos:
      | dias |
      | 30   |
      | 15   |
      | 3    |

  Escenario: Documento vigente no genera alerta
    Dado que el Vehículo "ABC123" tiene un Documento "SOAT" que vence en 45 días
    Cuando el reloj de dominio evalúa los Vencimientos
    Entonces no se emite ninguna alerta "DocumentoPorVencer"
    Y el Estado de cumplimiento del Vehículo es "Vigente"

  Escenario: Cada umbral notifica una sola vez
    Dado que el Vehículo "ABC123" tiene un Documento "SOAT" que vence en 30 días
    Cuando el reloj de dominio evalúa los Vencimientos el mismo día
    Y vuelve a evaluar los Vencimientos al día siguiente con 29 días restantes
    Entonces la alerta del umbral de 30 días se emite una sola vez

  Escenario: El Semáforo toma el peor estado entre Documentos
    Dado que el Vehículo "ABC123" tiene un Documento "SOAT" que vence en 60 días
    Y un Documento "Revisión técnico-mecánica" que vence en 10 días
    Cuando el reloj de dominio evalúa los Vencimientos
    Entonces el Estado de cumplimiento del Vehículo es "Por vencer"

  Escenario: Documento que vence hoy exactamente está Por vencer, no Vencido
    Dado que el Vehículo "ABC123" tiene un Documento "SOAT" cuyo Vencimiento es la fecha de hoy
    Cuando el reloj de dominio evalúa los Vencimientos
    Entonces el estado del Documento es "Por vencer"
    Y el Estado de cumplimiento del Vehículo es "Por vencer"

  Escenario: Documento vencido pone el Semáforo en rojo
    Dado que el Vehículo "ABC123" tiene un Documento "SOAT" cuyo Vencimiento fue ayer
    Cuando el reloj de dominio evalúa los Vencimientos
    Entonces se emite el evento "DocumentoVencido" para el "SOAT"
    Y el Estado de cumplimiento del Vehículo es "Vencido"

  Escenario: Documento requerido ausente cuenta como Vencido
    Dado que el catálogo marca "Revisión técnico-mecánica" como requerida para el Vehículo "ABC123"
    Y que el Vehículo "ABC123" no tiene ningún Documento "Revisión técnico-mecánica"
    Cuando el reloj de dominio evalúa los Vencimientos
    Entonces el Estado de cumplimiento del Vehículo es "Vencido"
```
