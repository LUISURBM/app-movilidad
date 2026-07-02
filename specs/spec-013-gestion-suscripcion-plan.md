# spec-013 — Gestión de Suscripción y Plan (vehículos activos, límites y entitlements)

- **Bounded Context:** BC-8 Billing & Subscriptions
- **Prioridad:** V1
- **Estado:** Draft
- **Specs relacionadas:** spec-001 (onboarding crea Suscripción Free), spec-003 (Vehículo activo cuenta para facturación)

## Objetivo

Permitir que una **Empresa (Tenant)** gestione su **Suscripción** a un **Plan**, donde la métrica de cobro es **por vehículo activo/mes**. El sistema controla los **límites del Plan** (número de vehículos) con **bloqueo suave + upsell** (no bloqueo duro), gestiona el ciclo de vida de la Suscripción (Trial, Activa, Morosa, Suspendida, Cancelada) y expone los **entitlements** (qué habilita el Plan) que los demás contextos consumen. No se inventan precios; los importes se fijan tras validar disposición a pagar.

## Actor(es)

- **Administrador/Owner**: único Rol con permiso de gestionar la Suscripción/billing.
- **Billing & Subscriptions (BC-8)**: gestiona Planes, Suscripciones, conteo de vehículos activos y entitlements.
- **Sistema**: reacciona a eventos de Fleet (`VehiculoRegistrado`) para el conteo.

## Reglas de negocio

1. Solo el Rol **Administrador/Owner** puede gestionar la Suscripción y el billing (mínimo privilegio).
2. Una **Suscripción** vincula un **Tenant** a un **Plan** con ciclo de cobro mensual.
3. La métrica de cobro es **por vehículo activo/mes**; un vehículo activo es el que está operativo (no archivado/dado de baja).
4. El conteo de vehículos activos lo lleva Billing reaccionando a `VehiculoRegistrado` y al ciclo de vida del Vehículo.
5. **Límite por Plan con bloqueo suave:** si el Tenant intenta registrar un Vehículo por **encima** del límite de su Plan, **no** se rompe la operación de los Vehículos existentes; se muestra un **upsell** y se ofrece el upgrade. Nunca se quita acceso a datos ya cargados.
6. El Plan **Free** permite **1** vehículo; al intentar el segundo, se ofrece upgrade (el gancho de conversión).
7. **Upgrade:** efecto **inmediato** (habilita límites/features del nuevo Plan al instante).
8. **Downgrade:** efecto al **siguiente ciclo**; si el Tenant tiene más vehículos que el nuevo Plan permite, se le pide reducir o se mantienen en bloqueo suave los excedentes.
9. Al activarse una Suscripción paga se emite `SuscripcionActivada { tenantId, planId, vehiculosIncluidos }`, que IAM y los demás contextos consumen para ajustar **entitlements**.
10. Los **entitlements** son un mapa simple Plan → límites/flags; se verifican en la capa de aplicación (la API rechaza lo no incluido aunque el front lo oculte).
11. Los datos de facturación son datos personales (Habeas Data) y se aíslan por Tenant; los datos sensibles de pago **no se almacenan** (los custodia la pasarela).
12. **No se inventan importes en pesos**; los precios se fijan tras validar disposición a pagar.

## Casos felices

- El Administrador, en plan Free con 1 vehículo, hace upgrade a un Plan de flota y registra más vehículos de inmediato.

## Casos alternativos

- El Administrador inicia un **Trial** de un Plan pago y al vencer pasa a Free si no registró medio de pago.
- El Administrador hace **downgrade**; el efecto aplica al siguiente ciclo.

## Casos de error

- En plan Free, el Administrador intenta registrar el segundo vehículo: se muestra upsell, no se rompe la operación del primero.
- Un Usuario sin Rol Administrador/Owner intenta gestionar la Suscripción: se rechaza por permiso.

## Criterios de aceptación (Gherkin)

```gherkin
# language: es
Característica: Gestión de Suscripción y Plan con métrica por vehículo activo
  Como Administrador/Owner de una Empresa
  Quiero gestionar mi Suscripción y respetar los límites del Plan
  Para pagar de forma alineada al valor sin perder acceso a mis datos

  Antecedentes:
    Dado que existe la Empresa "Transporte Duster SAS" como Tenant
    Y que un Usuario con rol "Administrador/Owner" está autenticado en esa Empresa

  Escenario: Bloqueo suave al exceder el límite del Plan Free
    Dado que la Empresa tiene una Suscripción en plan "Free" con límite de 1 vehículo
    Y que ya tiene registrado 1 vehículo activo
    Cuando el Administrador intenta registrar un segundo vehículo
    Entonces no se registra el segundo vehículo
    Y se muestra un mensaje de upsell para subir de Plan
    Y el primer vehículo conserva su acceso y sus datos

  Escenario: Upgrade con efecto inmediato
    Dado que la Empresa tiene una Suscripción en plan "Free"
    Cuando el Administrador hace upgrade a un Plan de flota
    Entonces el nuevo límite de vehículos se habilita de inmediato
    Y se emite el evento "SuscripcionActivada" con el nuevo Plan
    Cuando el Administrador registra un segundo vehículo
    Entonces el registro es exitoso

  Escenario: Trial que vence sin medio de pago pasa a Free
    Dado que la Empresa inició un Trial de un Plan pago
    Cuando el Trial vence sin que se registre medio de pago
    Entonces la Suscripción pasa a plan "Free"
    Y los datos del Tenant se conservan

  Escenario: Downgrade aplica al siguiente ciclo
    Dado que la Empresa tiene una Suscripción en un Plan de flota
    Cuando el Administrador solicita downgrade a un Plan menor
    Entonces el cambio queda programado para el siguiente ciclo
    Y el Plan actual se mantiene hasta el fin del ciclo

  Escenario: Un usuario sin permiso no puede gestionar la Suscripción
    Dado que existe un Usuario con rol "Operador"
    Cuando el Operador intenta cambiar el Plan de la Suscripción
    Entonces la acción se rechaza por falta de permiso

  Escenario: Aislamiento de los datos de facturación entre Tenants
    Dado que la Empresa "Empresa A" tiene datos de facturación
    Y que un Usuario está autenticado en la Empresa "Empresa B"
    Cuando el Usuario de "Empresa B" consulta la facturación de su Empresa
    Entonces no obtiene datos de facturación de "Empresa A"
```
