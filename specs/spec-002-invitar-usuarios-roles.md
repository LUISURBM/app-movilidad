# spec-002 — Invitar usuarios y asignar roles dentro del Tenant

- **Bounded Context:** BC-1 Identity & Access
- **Prioridad:** MVP
- **Estado:** Approved
- **Aprobada por:** Luis (Product Manager + dominio) · 2026-06-25
- **Specs relacionadas:** spec-001 (onboarding Empresa), spec-004 (registrar Conductor), spec-010 (operación del Conductor)

## Objetivo

Permitir que un Usuario con permiso de gestión de usuarios (Administrador/Owner) **invite** a nuevas personas a su **Empresa (Tenant)** y les asigne uno o más **Roles**. El invitado acepta, fija credenciales y queda **Activo** dentro de ese Tenant, con permisos acotados a su Rol. El aislamiento entre Empresas se mantiene: una invitación nunca cruza Tenants.

## Actor(es)

- **Administrador/Owner**: único Rol con permiso de gestionar usuarios e invitaciones.
- **Invitado**: persona que recibe la invitación (Operador, Gestor de Planilla, Representante Legal, Dueño de Vehículo o Conductor).
- **Sistema** (BC-1 Identity & Access): emite la invitación, gestiona su ciclo de vida y asigna Roles.

## Reglas de negocio

1. Solo el Rol **Administrador/Owner** puede invitar usuarios y asignar Roles.
2. La invitación se envía por correo e incluye al menos un Rol asignado.
3. Los Roles válidos son: Administrador/Owner, Operador, Gestor de Planilla, Representante Legal, Dueño de Vehículo, Conductor.
4. Un Usuario puede tener **uno o más** Roles dentro del mismo Tenant.
5. En el MVP, un Usuario pertenece a **un único** Tenant (relación Usuario → Tenant uno a uno); la multi-membresía es una costura diferida.
6. Al emitir la invitación se publica el evento `UsuarioInvitado { usuarioId, tenantId, roles }`.
7. El ciclo de vida del Usuario es: Invitado → Activo → (Suspendido ↔ Activo) → Removido; Invitado → Expirado si la invitación vence sin aceptarse.
8. Un invitado solo queda **Activo** tras aceptar y fijar credenciales en el proveedor de identidad.
9. Un Usuario **Suspendido** no puede autenticarse, pero su historial y datos de negocio producidos se conservan en el Tenant.
10. Al **Remover** un Usuario, los datos de negocio que produjo (servicios, tanqueos, novedades) permanecen en el Tenant (son del Tenant, no del Usuario).
11. Un Operador, Conductor o cualquier Rol distinto de Administrador/Owner **no** puede invitar usuarios.

## Casos felices

- El Administrador invita a un Operador, este acepta y queda Activo con permisos de operación.
- El Administrador invita a un Conductor con Rol Conductor para que use la app móvil.

## Casos alternativos

- El Administrador asigna **dos Roles** al mismo invitado (p. ej. Operador y Gestor de Planilla).
- El Administrador **suspende** y luego **reactiva** a un Usuario sin perder su historial.

## Casos de error

- Un Usuario sin permiso (p. ej. Operador) intenta invitar: la acción se rechaza.
- La invitación vence sin que el invitado la acepte: pasa a Expirado.
- Se intenta invitar con un correo que ya es Usuario activo del Tenant: se rechaza.

## Criterios de aceptación (Gherkin)

```gherkin
# language: es
Característica: Invitar usuarios y asignar roles dentro del Tenant
  Como Administrador/Owner de una Empresa
  Quiero invitar usuarios y asignarles roles
  Para que operen dentro de mi Tenant con los permisos correctos

  Antecedentes:
    Dado que existe la Empresa "Transporte Duster SAS" como Tenant
    Y que existe un Usuario con rol "Administrador/Owner" autenticado en esa Empresa

  Escenario: Invitar a un Operador y dejarlo activo
    Cuando el Administrador invita el correo "operador@duster.co" con el rol "Operador"
    Entonces se emite el evento "UsuarioInvitado" para ese correo con el rol "Operador"
    Y el Usuario queda en estado "Invitado"
    Cuando el invitado acepta y fija sus credenciales
    Entonces el Usuario queda en estado "Activo"
    Y puede actuar con el rol "Operador" dentro de la Empresa "Transporte Duster SAS"

  Escenario: Invitar a un Conductor para la app móvil
    Cuando el Administrador invita el correo "juan.conductor@duster.co" con el rol "Conductor"
    Entonces se emite el evento "UsuarioInvitado" con el rol "Conductor"
    Y al aceptar, el Conductor solo tiene alcance sobre sus propios recursos

  Escenario: Asignar varios roles a un mismo invitado
    Cuando el Administrador invita el correo "gestor@duster.co" con los roles "Operador" y "Gestor de Planilla"
    Y el invitado acepta y fija credenciales
    Entonces el Usuario queda "Activo" con los roles "Operador" y "Gestor de Planilla"

  Escenario: Suspender y reactivar un usuario conservando su historial
    Dado que existe un Usuario "Activo" con rol "Conductor"
    Cuando el Administrador lo suspende
    Entonces el Usuario queda en estado "Suspendido"
    Y no puede autenticarse
    Y su historial se conserva
    Cuando el Administrador lo reactiva
    Entonces el Usuario vuelve al estado "Activo"

  Escenario: Un usuario sin permiso no puede invitar
    Dado que existe un Usuario "Activo" con rol "Operador"
    Cuando el Operador intenta invitar el correo "otro@duster.co"
    Entonces la acción se rechaza por falta de permiso

  Escenario: La invitación vence sin aceptarse
    Dado que el Administrador invitó el correo "tardio@duster.co" con el rol "Conductor"
    Cuando la invitación vence sin que el invitado la acepte
    Entonces el Usuario queda en estado "Expirado"

  Escenario: Rechazo por correo ya activo en el Tenant
    Dado que el correo "operador@duster.co" ya es un Usuario "Activo" del Tenant
    Cuando el Administrador intenta invitarlo de nuevo
    Entonces la invitación se rechaza
    Y se informa que el correo ya pertenece a un Usuario activo
```
