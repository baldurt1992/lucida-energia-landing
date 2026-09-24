# Informe de QA

Validación realizada el 24 de septiembre de 2026 sobre el build de producción.

## Compilación

```text
astro check: 0 errores, 0 advertencias
astro build: correcto
```

## Responsive

La landing se probó automáticamente con Chromium en:

- móvil: 390 × 844 px;
- tablet: 768 × 1024 px;
- escritorio: 1440 × 900 px.

En los tres tamaños se verificó:

- ausencia de desbordamiento horizontal;
- presencia de las 13 secciones;
- un único `h1` visible perteneciente al sitio;
- adaptación vertical de las escenas fijadas en móvil.

## Formulario

Se completó el flujo con nombre acentuado, teléfono español, email, tipo de cliente y mensaje. El resultado fue:

```text
Solicitud recibida
Gracias por contarnos tu caso. Nos pondremos en contacto contigo para revisar los próximos pasos.
```

No quedaron errores de campo después del envío. El adaptador es simulado y no persiste datos.

## Lighthouse

Medición móvil sobre `astro preview`, sin el toolbar de desarrollo:

- Performance: **89**
- Accessibility: **100**
- Best Practices: **77**
- SEO: **100**

La reducción de Best Practices proviene de cookies técnicas establecidas por el CDN de Pexels al servir las fotografías remotas. Lighthouse también identifica oportunidades menores en compresión de imágenes y JavaScript no utilizado.

## Accesibilidad comprobada

- estructura semántica y jerarquía de encabezados;
- enlace para saltar al contenido;
- navegación y formulario utilizables con teclado;
- foco visible;
- errores asociados a sus controles;
- regiones de estado para validación y confirmación;
- alternativa equivalente con `prefers-reduced-motion`;
- contraste evaluado por Lighthouse sin incidencias.

## Resultado

No se detectaron bloqueos funcionales ni problemas responsive. La optimización prioritaria para una versión de producción sería servir localmente las fotografías en formatos modernos para eliminar la dependencia y las cookies del CDN externo.
