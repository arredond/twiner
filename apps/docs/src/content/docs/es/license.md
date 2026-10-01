---
title: Licencia y cita
description: Las licencias de TWIN-ER para el código, la documentación y los datos, y cómo citarlo.
---

TWIN-ER es de código abierto. Sus partes tienen estas licencias.

| Parte | Licencia |
|---|---|
| Código fuente: API de escenarios, pipelines, aplicación web, infraestructura | [GNU Affero General Public License v3.0 o posterior](https://www.gnu.org/licenses/agpl-3.0.html) (AGPL-3.0-or-later) |
| Esta documentación: textos, figuras y diagramas | [Creative Commons Reconocimiento 4.0 Internacional](https://creativecommons.org/licenses/by/4.0/deed.es) (CC BY 4.0) |
| Conjuntos de datos de entrada | La licencia de cada organismo (ver [Fuentes de datos](/docs/es/data-sources/)) |

Los textos completos están en el repositorio:
[`LICENSE`](https://github.com/arredond/twiner/blob/main/LICENSE) para el
código y
[`apps/docs/LICENSE`](https://github.com/arredond/twiner/blob/main/apps/docs/LICENSE)
para la documentación.

## Código: AGPL-3.0

Puedes usar, estudiar, modificar y redistribuir el código, también con
fines comerciales, en los términos de la AGPL. En resumen:

- si distribuyes TWIN-ER o una versión modificada, debes poner a
  disposición el código fuente correspondiente con la misma licencia;
- si ejecutas una versión modificada como **servicio en red**, debes
  ofrecer su código fuente a los usuarios de ese servicio. La aplicación
  web lo hace con el enlace "Código fuente" de su menú de ajustes.

El motor de escenarios se apoya en la biblioteca `hazardlib` de OpenQuake
(Fundación GEM), que también tiene licencia AGPL v3.

## Documentación: CC BY 4.0

Puedes compartir y adaptar esta documentación con cualquier fin, siempre
que reconozcas la autoría, enlaces a la licencia e indiques los cambios.

## Datos

Los resultados se derivan de los conjuntos de datos de terceros que
recogen las [Fuentes de datos](/docs/es/data-sources/), y siguen sujetos a
sus licencias y requisitos de atribución. En particular:

- la base de datos de fallas QAFI tiene licencia CC BY-SA 4.0, así que los
  datos derivados de ella deben compartirse en los mismos términos;
- el mapa base de OpenStreetMap tiene licencia ODbL;
- las funciones de fragilidad de Martins y Silva (2021) se publican para
  uso libre citando la fuente, sin licencia formal.

## Cómo citar TWIN-ER

Si usas TWIN-ER o sus resultados en investigación, cita el proyecto y los
modelos en los que se basa (ver las referencias de cada página de riesgo):

> Arredondo, Á. (2026). *TWIN-ER: an open multi-hazard risk simulator for
> Spain*. https://twiner.arredon.do
