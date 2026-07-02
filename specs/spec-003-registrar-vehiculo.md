# spec-003 — Registrar un Vehículo (placa única por Tenant, odómetro monótono)

- **Bounded Context:** BC-2 Fleet Management
- **Prioridad:** MVP
- **Estado:** Approved
- **Aprobada por:** Luis (Product Manager + dominio) · 2026-06-25
- **Specs relacionadas:** spec-005 (registrar Documento), spec-008 (asignar Vehículo a Servicio), spec-011 (Tanqueo), spec-012 (Mantenimiento)

## Objetivo

Permitir registrar un **Vehículo** dentro de una **Empresa (Tenant)** con sus datos básicos (placa, clase, marca, modelo), su **Propietario** y, opcionalmente, su **Afiliación** a una empresa transportadora. La **Placa** es única por Tenant e inmutable durante la vida del registro. La lectura del **Odómetro** es autoritativa y **monótonamente creciente**: una lectura nunca puede ser menor a la anterior registrada. Al registrarse, el Vehículo dispara la creación de su expediente de cumplimiento en BC-4.

## Actor(es)

- **Administrador/Owner** u **Operador**: registran y editan Vehículos.
- **Dueño de Vehículo**: puede ver el estado de sus propios Vehículos (alcance propio).
- **Sistema** (BC-2 Fleet Management): valida placa única, monotonía del odómetro y emite eventos.

## Reglas de negocio

1. Solo los Roles Administrador/Owner u Operador pueden dar de alta un Vehículo.
2. La **Placa** es **única por Tenant** (`UNIQUE(tenant_id, placa)`), no global: dos Empresas distintas pueden registrar la misma placa.
3. La **Placa es inmutable** una vez creado el registro del Vehículo.
4. Datos mínimos para el alta: placa, clase, marca, modelo y Propietario.
5. El **Odómetro** inicial es opcional; si se informa, es la primera lectura autoritativa.
6. Toda actualización posterior del Odómetro debe ser **mayor o igual** a la última lectura registrada (monotonía): una lectura menor se **rechaza**.
7. La **Afiliación** a una empresa transportadora es un dato opcional del Vehículo; se modela como dato del Vehículo, no como relación entre Tenants.
8. Al registrar el Vehículo se emite el evento `VehiculoRegistrado { vehiculoId, placa, clase, propietarioId }`.
9. Si se registra la Afiliación, se emite el evento `VehiculoAfiliado { vehiculoId, empresaTransportadoraId, desde }`.
10. El registro del Vehículo crea su **Expediente de cumplimiento** en BC-4 (vía evento), inicialmente con los Documentos requeridos ausentes (Semáforo en rojo hasta cargarlos).
11. El conteo de **vehículos activos** para facturación (BC-8) reacciona a `VehiculoRegistrado`.

## Casos felices

- El Operador registra la Renault Duster con placa "ABC123", clase "Automóvil", su Propietario y odómetro inicial 152000 km.

## Casos alternativos

- El Operador registra un Vehículo sin odómetro inicial; la primera lectura llega luego por un Tanqueo o Servicio.
- El Operador registra el Vehículo y además su Afiliación a la empresa transportadora.

## Casos de error

- Se intenta registrar un Vehículo con una placa ya existente en el mismo Tenant: se rechaza.
- Se intenta actualizar el Odómetro con una lectura menor a la última registrada: se rechaza por monotonía.
- Se intenta cambiar la placa de un Vehículo ya creado: se rechaza por inmutabilidad.

## Criterios de aceptación (Gherkin)

```gherkin
# language: es
Característica: Registrar un Vehículo con placa única por Tenant y odómetro monótono
  Como Operador de una Empresa
  Quiero registrar un Vehículo con sus datos básicos
  Para gestionar su cumplimiento, sus servicios y sus costos

  Antecedentes:
    Dado que existe la Empresa "Transporte Duster SAS" como Tenant
    Y que un Usuario con rol "Operador" está autenticado en esa Empresa

  Escenario: Alta exitosa de un Vehículo con odómetro inicial
    Cuando el Operador registra un Vehículo con placa "ABC123", clase "Automóvil", marca "Renault", modelo "Duster" y odómetro inicial 152000
    Entonces el Vehículo queda registrado en la Empresa "Transporte Duster SAS"
    Y la lectura autoritativa del Odómetro es 152000
    Y se emite el evento "VehiculoRegistrado" con la placa "ABC123"
    Y se crea su Expediente de cumplimiento en estado documental pendiente

  Escenario: Alta de un Vehículo sin odómetro inicial
    Cuando el Operador registra un Vehículo con placa "XYZ789", clase "Microbús", marca "Chevrolet", modelo "NPR" y sin odómetro inicial
    Entonces el Vehículo queda registrado
    Y el Odómetro queda sin lectura inicial hasta que llegue una desde un Tanqueo o Servicio

  Escenario: Alta de un Vehículo con Afiliación a empresa transportadora
    Cuando el Operador registra un Vehículo con placa "DEF456" afiliado a la empresa transportadora "Transportes del Valle" desde "2026-06-01"
    Entonces el Vehículo queda registrado con su Afiliación
    Y se emite el evento "VehiculoAfiliado" para la empresa transportadora "Transportes del Valle"

  Escenario: Rechazo por placa duplicada en el mismo Tenant
    Dado que ya existe un Vehículo con placa "ABC123" en la Empresa "Transporte Duster SAS"
    Cuando el Operador intenta registrar otro Vehículo con placa "ABC123"
    Entonces el registro se rechaza
    Y se informa que la placa ya existe en la Empresa

  Escenario: La misma placa puede existir en Tenants distintos
    Dado que existe un Vehículo con placa "ABC123" en la Empresa "Empresa A"
    Y que un Operador está autenticado en la Empresa "Empresa B"
    Cuando el Operador registra un Vehículo con placa "ABC123" en la Empresa "Empresa B"
    Entonces el registro es exitoso
    Y ambas Empresas mantienen su propio Vehículo aislado

  Escenario: Rechazo de actualización de Odómetro por monotonía
    Dado que el Vehículo con placa "ABC123" tiene una lectura de Odómetro de 152000
    Cuando se intenta actualizar el Odómetro a 151500
    Entonces la actualización se rechaza por violar la monotonía del Odómetro
    Y la lectura autoritativa sigue siendo 152000

  Escenario: Rechazo de cambio de placa por inmutabilidad
    Dado que el Vehículo con placa "ABC123" ya está registrado
    Cuando se intenta cambiar su placa a "GHI321"
    Entonces el cambio se rechaza por ser la Placa inmutable
```
