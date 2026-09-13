# Volquetas — app instalable (PWA)

App para que **el conductor registre sus viajes desde el celular con foto del vale**, y la
**oficina los valide en línea** y emita la cuenta de cobro.

Funciona sin señal: lo que el conductor registra se guarda en su teléfono y se envía solo
cuando vuelve a tener internet.

---

## Qué hay en esta carpeta

| Archivo | Para qué |
|---|---|
| `index.html` | La app |
| `app.js` | Toda la lógica |
| `sw.js` | Hace que abra sin señal |
| `manifest.webmanifest` | Permite instalarla en la pantalla de inicio |
| `icon-192.png`, `icon-512.png`, `icon-maskable.png` | El ícono de la app |

Los cinco archivos van juntos, en la misma carpeta. No cambies los nombres.

---

## Paso 1 — Publicar la app en internet

La app necesita una dirección `https://` para poder instalarse en el celular. La forma
más rápida, sin cuenta ni tarjeta:

1. Entra a **https://app.netlify.com/drop**
2. Arrastra **la carpeta completa** a la página.
3. En unos segundos te da una dirección tipo `https://algo-algo-123.netlify.app`.
   Esa es la dirección de tu app.

Otras opciones que sirven igual: GitHub Pages, Vercel, Cloudflare Pages, o el hosting
que ya tengas. Solo debe ser `https://`.

---

## Paso 2 — Crear la base de datos compartida (gratis)

Sin este paso la app funciona, pero cada teléfono guarda lo suyo por separado. Para que
el conductor y la oficina vean lo mismo:

1. Entra a **https://console.firebase.google.com** con tu cuenta de Google.
2. **Agregar proyecto** → ponle un nombre (ej. `volquetas-mi-empresa`) → puedes desactivar
   Google Analytics → **Crear**.
3. En el menú de la izquierda: **Compilación → Realtime Database → Crear base de datos**.
4. Elige la ubicación que te ofrezca y selecciona **iniciar en modo de prueba**.
5. Arriba te muestra la dirección, algo como
   `https://volquetas-mi-empresa-default-rtdb.firebaseio.com`. **Cópiala.**

> **Importante sobre el modo de prueba:** caduca a los 30 días y, mientras está activo,
> cualquiera que adivine la dirección puede leer los datos. Antes de que caduque, entra a
> la pestaña **Reglas** y reemplázalas por estas, cambiando `TU-CODIGO-SECRETO` por algo
> largo y difícil de adivinar (ese mismo texto lo pones como "código de tu empresa" en el
> paso 3):
>
> ```json
> {
>   "rules": {
>     "TU-CODIGO-SECRETO": { ".read": true, ".write": true }
>   }
> }
> ```
>
> Esto no es una seguridad fuerte: quien tenga el código de conexión entra. Sirve para
> datos de operación entre gente de confianza. Si más adelante necesitas usuario y
> contraseña de verdad por conductor, se hace con Firebase Authentication y hay que
> ampliar la app.

---

## Paso 3 — Configurar la oficina

1. Abre la dirección de tu app en el computador.
2. **Soy administrador** → crea una clave de 4 dígitos (queda guardada en ese equipo).
3. **Ajustes → Conexión**: pega la dirección de Firebase y escribe el código de tu empresa
   (el mismo `TU-CODIGO-SECRETO` de arriba). **Guardar y probar** — debe decir *Conectado*.
4. **Ajustes → Empresa**: tus datos, el prefijo del documento y los porcentajes de IVA y
   retenciones.
5. **Ajustes → Clientes / Obras / Volquetas / Conductores**: carga los maestros.
   En cada obra van las dos tarifas: **valor fijo por viaje** y **valor por m³**.
   Tiene que existir el conductor para que él pueda elegirse en su celular.
6. Vuelve a **Ajustes → Conexión** y toca **Copiar código**. Ese es el código que le envías
   a cada conductor por WhatsApp.

---

## Paso 4 — Instalar en el celular del conductor

1. Le mandas al conductor **la dirección de la app** y **el código de conexión**.
2. Él abre la dirección en el celular.
   - **Android (Chrome):** menú ⋮ → *Agregar a pantalla principal* / *Instalar aplicación*.
   - **iPhone (Safari):** botón Compartir → *Agregar a pantalla de inicio*.
3. Abre la app desde el ícono → **Soy conductor** → pega el código → **Conectar**.
4. Toca su nombre en la lista. Queda guardado en ese teléfono.

---

## El día a día

**Conductor**
- Toca **Registrar un viaje**, elige obra y placa, escribe el número de vale, la cantidad
  de viajes y los m³, y toma la **foto del vale** con la cámara.
- Guarda. Si no hay señal, queda marcado *Por enviar* y sale solo cuando vuelva la señal.
- En **Mis viajes** ve el estado: *Por validar*, *Aprobado* o *Rechazado* con el motivo.
  Un viaje rechazado lo puede corregir y volver a enviar. Uno aprobado ya no lo puede tocar.

**Oficina**
- **Validar**: la cola de pendientes, agrupada por día, con la foto del vale al lado.
  Puede aprobar uno por uno, corregir, rechazar con motivo, o aprobar el día completo.
- **Viajes**: todo el periodo, con filtro por estado y resumen por obra.
- **Costos**: combustible, peajes, mantenimiento, por placa.
- **Cobro**: elige el cliente y genera la cuenta de cobro **solo con viajes aprobados**.
  Esos viajes pasan a *Facturado* y ya no se pueden volver a cobrar.

---

## Cosas que conviene saber

- **Las fotos se comprimen** a un tamaño razonable antes de guardarse, para no gastar los
  datos del conductor ni llenar la base.
- **La clave de 4 dígitos** solo protege el modo administrador en ese teléfono. No es una
  contraseña de servidor.
- **Cada teléfono guarda su copia.** Si el conductor borra la app, pierde lo que no haya
  alcanzado a enviar.
- **Los porcentajes de IVA y retenciones** vienen sugeridos para transporte de carga en
  Colombia (IVA 19%, retención en la fuente 1%). Confírmalos con tu contador.
- **Para actualizar la app** más adelante: vuelves a subir la carpeta al mismo sitio. Los
  celulares toman la versión nueva la próxima vez que abran con señal.
