# Backend inicial — Macaron & Bakery

Este backend conecta el frontend React/Vite con MariaDB de XAMPP. En esta primera etapa implementa autenticación y una entrada/salida por empleado al día.

## 1. Preparar XAMPP

1. Inicia Apache y MySQL desde el panel de XAMPP (Apache solo es necesario para phpMyAdmin; MariaDB/MySQL es necesario para la API).
2. Abre phpMyAdmin y confirma que existe la base `macaron_bakery`.
3. Antes de ejecutar `sql/01_ajustar_asistencia.sql`, realiza un respaldo de la base.
4. Ejecuta el SQL de ajuste. Primero revisa el comentario de duplicados del propio archivo.

El SQL elimina las columnas `id_registro_entrada` e `id_registro_salida`, porque sus claves foráneas apuntaban incorrectamente a `empleado`. Para este alcance se usan directamente `fecha_hora_entrada` y `fecha_hora_salida`.

## 2. Configurar backend

En una terminal:

```bash
cd backend
npm install
```

Copia `.env.example` como `.env` y revisa los valores. En una instalación local típica de XAMPP, el usuario suele ser `root`, la contraseña puede estar vacía y el puerto suele ser `3306`; confirma tus propios valores en XAMPP.

Cambia `SESSION_SECRET` por una cadena larga y aleatoria. No compartas ni subas `.env` a Git.

## 3. Crear contraseña compatible

La API espera que `empleado.contrasena` contenga un hash bcrypt. Para generar uno:

```bash
npm run hash-password -- "UnaContraseñaSegura"
```

Copia el hash generado y guárdalo en `empleado.contrasena` para el empleado correspondiente desde phpMyAdmin. No guardes la contraseña en texto plano.

La tabla `empleado` debe tener `usuario`, `contrasena`, `activo`, `intentos_fallidos`, `bloqueado`, `id_rol` y `puesto`; además, debe existir el rol referenciado en `rol`.

## 4. Iniciar y comprobar

```bash
npm run dev
```

Abre `http://localhost:3000/api/health`. La respuesta debe indicar `ok: true` y `database: macaron_bakery`.

## 5. Rutas disponibles

- `POST /api/auth/login` — `{ "username": "usuario", "password": "contraseña" }`
- `GET /api/auth/me` — empleado de la sesión actual.
- `POST /api/auth/logout` — cerrar sesión.
- `GET /api/attendance/today` — asistencia del día del empleado autenticado.
- `GET /api/attendance/history` — últimos 30 registros del empleado autenticado.
- `POST /api/attendance/clock-in` — registrar entrada.
- `POST /api/attendance/clock-out` — registrar salida.

Las rutas de asistencia toman `id_empleado` de la sesión del servidor, nunca del cuerpo enviado por el navegador.

## Nota de entorno

Este es un backend de desarrollo local. `express-session` utiliza el almacén de memoria predeterminado; antes de desplegarlo para uso real se debe configurar un almacén de sesiones persistente, HTTPS, cookies seguras y una política de respaldo/seguridad apropiada. La interfaz todavía no se conecta a estas rutas; esa será la siguiente modificación del frontend después de comprobar la conexión de la API con MariaDB.
