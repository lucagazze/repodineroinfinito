# Por que un push puede no desplegar

**Sintoma:** `git push` dice OK, Vercel registra el despliegue, y el sitio no cambia.
En el panel el despliegue figura como **BLOCKED**, sin log de build.

**Causa:** Vercel atribuye cada despliegue al autor del commit. Si ese correo no
corresponde a ninguna cuenta de Vercel del equipo, el despliegue se bloquea antes de
compilar. Este repo no tenia `user.email` configurado, asi que git caia en el valor por
defecto de la maquina:

    brunogazze@MacBook-Air-de-Bruno-M4.local

que no es una direccion real. **Dos commits quedaron bloqueados sin que nadie lo notara:**

| commit | que traia | estado hasta el 31/10/2026 |
|---|---|---|
| `6846ede` | la guardia que impide cobrar dos veces el mismo libro | BLOCKED, nunca llego a produccion |
| `5db1e85` | decir el plazo de preventa antes de cobrar | BLOCKED |

**Arreglo**, ya aplicado en este repo:

```
git config user.email "81053631+lucagazze@users.noreply.github.com"
git config user.name  "Bruno Gazze"
```

Es la misma identidad con la que `physicstudylab` si despliega. No se puso global a
proposito: cada repo declara la suya.

**Como se comprueba que un push desplego de verdad** — y esto es lo unico que vale,
porque el push que no despliega se ve exactamente igual que el que si:

1. El despliegue tiene que decir `READY`, no `BLOCKED`.
2. Y despues, pedirle al sitio vivo lo que cambiaste y encontrarlo. Un `curl` al
   dominio real, buscando el texto nuevo. Si no esta, no desplego, diga lo que diga
   el push.

Los demas repos del grupo (studiofacile, fransa-propiedades, checkout-propio, bruno-landing)
siguen con la identidad vieja y van a chocar con esto mismo.
