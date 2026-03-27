# Syscraping

Aplicacion web local en Node.js para lanzar scraping desde una interfaz amigable, guardar historial en MySQL y exportar resultados en JSON, CSV y Excel.

## Requisitos

- Node.js 18 o superior
- NPM 9 o superior
- MySQL local

## Variables de entorno

Este proyecto ya puede leer un archivo `.env` en la raiz.

1. Copia `.env.example` como `.env`
2. Ajusta los valores si en el otro equipo MySQL usa otro puerto, usuario o password

Ejemplo:

```env
PORT=3000
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=syscraping
```

## Preparar base de datos

Crea la base local antes de iniciar:

```sql
CREATE DATABASE syscraping CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

Las tablas se crean automaticamente al arrancar la app.

## Instalacion

```bash
npm install
npx playwright install
```

## Ejecutar interfaz web

```bash
npm start
```

Luego abre [http://localhost:3000](http://localhost:3000).

## Uso

1. Ingresa la URL objetivo.
2. Ingresa la palabra clave a buscar.
3. Ajusta selectores si el sitio cambia.
4. Ejecuta el scraping.
5. Descarga los resultados en JSON, CSV o Excel.

## Ejecutar por CLI

```bash
npm run scrape:config
```

## Moverlo a otro equipo local

```bash
git clone <URL-DEL-REPOSITORIO>
cd syscraping
copy .env.example .env
npm install
npx playwright install
npm start
```

## Subirlo a Git

Si aun no creas el remoto, por ejemplo en GitHub, crea un repositorio vacio y luego ejecuta:

```bash
git add .
git commit -m "feat: prepara despliegue local"
git remote add origin <URL-DEL-REPOSITORIO>
git push -u origin main
```

## Archivos ignorados

No se suben a Git:

- `node_modules/`
- `outputs/`
- `storage/`
- `.env`
- `scraper.config.json`

## Archivos principales

- `public/index.html`: interfaz web
- `public/app.js`: envio del formulario y render de resultados
- `public/styles.css`: estilos
- `src/server.js`: servidor HTTP local
- `src/scraper.js`: logica del scraping reutilizable
- `src/index.js`: ejecucion por consola usando archivo de configuracion
