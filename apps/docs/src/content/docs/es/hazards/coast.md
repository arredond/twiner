---
title: twinCOAST
description: Cómo estima TWIN-ER la exposición a inundaciones costeras a partir de las zonas inundables de origen marino oficiales del MITECO.
---

twinCOAST muestra qué edificios, personas e infraestructuras críticas están
dentro de las **zonas inundables costeras oficiales** para un periodo de
retorno y una zona elegidos: el terreno al que llega el mar en un temporal.
Los resume por sección censal y municipio, igual que
[twinFLOOD](/docs/es/hazards/flood/) hace con los ríos.

El método es el de twinFLOOD, aplicado a otra cartografía. Esta página
recoge lo que cambia; [twinFLOOD](/docs/es/hazards/flood/) describe el
método común al completo.

## Los mapas de inundación costera

La Directiva de Inundaciones de la UE (2007/60/CE) [1] cubre la inundación
de origen marino además de la fluvial. En aplicación del Real Decreto
903/2010 [2], el Ministerio para la Transición Ecológica (MITECO) cartografió
las **áreas de riesgo potencial significativo de inundación (ARPSI)
costeras** y publicó su extensión en el Sistema Nacional de Cartografía de
Zonas Inundables (SNCZI) [3], como "zonas inundables de origen marino".

Las extensiones proceden de los estudios costeros de 2014:

- nivel del mar y oleaje a partir de unos 60 años de datos de reanálisis;
- remonte del oleaje calculado en perfiles cada 200 m a lo largo de la
  costa;
- la cota de inundación resultante proyectada sobre un modelo digital del
  terreno de 5 m.

### Periodos de retorno

Solo hay mapas costeros para **dos** periodos de retorno:

| Periodo de retorno | Probabilidad anual | En 30 años | Categoría del SNCZI |
|---|---|---|---|
| T = 100 años | 1% | 26% | Probabilidad media u ocasional |
| T = 500 años | 0,2% | 6% | Probabilidad baja o excepcional |

Consulta [twinFLOOD](/docs/es/hazards/flood/#periodos-de-retorno) para
saber qué significa un periodo de retorno.

### Qué cubren los mapas

- **Solo la costa estudiada.** Hay zonas en los 397 tramos de costa
  identificados como ARPSI: unos 2.000 km² de tierra en cualquiera de los
  dos periodos, en 386 municipios.
- **Toda la costa de España, islas incluidas.** Canarias, Baleares, Ceuta
  y Melilla están cartografiadas en los dos periodos, así que, a diferencia
  de la inundación fluvial, no hay nada "sin mapa".
- **Estuarios.** El mar remonta las desembocaduras, así que algunos
  municipios del interior tienen zonas inundables costeras: Sevilla, en el
  estuario del Guadalquivir, es el caso más claro.

## Método

Igual que en [twinFLOOD](/docs/es/hazards/flood/#método):

1. Las zonas se reparan, se simplifican con una tolerancia de 1 m, se
   cortan por sección censal y se agrupan por sección y periodo de retorno.
   Los ficheros costeros vienen en coordenadas geográficas, así que antes se
   proyectan a una malla equivalente en metros, para que la tolerancia de
   1 m siga siendo 1 m.
2. Un edificio está en la zona si su **huella** la interseca. Las
   infraestructuras críticas pasan la misma prueba.
3. Un escenario es un periodo de retorno y una zona: un círculo de hasta
   200 km, o una comunidad autónoma, provincia o municipio.

La superficie de las zonas que queda fuera de toda sección censal, sobre
todo en el mar, no se cuenta (unos 185 km² en cada periodo).

### Solo zonas con superficie inundable costera

El selector de zona y el buscador solo ofrecen las comunidades autónomas,
provincias y municipios que tienen zona inundable costera. La lista sale de
los propios mapas procesados, no de una lista de provincias costeras: un
municipio aparece si una zona cubre al menos 1.000 m² de él, o si alguno de
sus edificios está en una zona. Así entran los municipios de estuario y
quedan fuera los costeros sin tramo estudiado. El umbral de 1.000 m²
descarta las astillas en las que una zona apenas roza el límite de un
municipio vecino.

## Resultados

De la ejecución nacional:

| Periodo de retorno | Municipios | Superficie inundable (km²) | Edificios en la zona |
|---|---|---|---|
| T = 100 | 385 | 2.025 | 43.288 |
| T = 500 | 386 | 2.080 | 48.949 |

Las provincias con más edificios en la zona de T = 500 son Las Palmas,
Sevilla, Santa Cruz de Tenerife, Cádiz y Málaga. La mayoría de las
infraestructuras críticas en la zona son puentes, seguidos de colegios e
instalaciones eléctricas.

## Resultados por zona

Los mismos que en twinFLOOD: edificios, viviendas, residentes y residentes
vulnerables en la zona, y superficie inundada, por sección censal y
municipio, además de las infraestructuras críticas dentro de la zona.
Consulta las
[estimaciones de impacto](/docs/es/impact-estimates/#cifras-de-inundación).

## Limitaciones

Se aplican todas las de [twinFLOOD](/docs/es/hazards/flood/#limitaciones),
y además:

- **Solo la costa estudiada.** Fuera de los tramos cartografiados, "ningún
  edificio en la zona" significa "sin mapa", no "sin riesgo".
- **Estudios de 2014, nivel del mar actual.** Los mapas no incluyen
  escenarios de subida del nivel del mar ni reflejan cambios posteriores en
  la costa.
- **Extensión, no calado.** El MITECO publica también calados costeros, que
  permitirían usar curvas calado-daño. Todavía no se usan.

## Referencias

1. Parlamento Europeo y Consejo (2007). Directiva 2007/60/CE, de 23 de
   octubre de 2007, relativa a la evaluación y gestión de los riesgos de
   inundación. *Diario Oficial de la Unión Europea*, L 288, 27–34.
   [eur-lex.europa.eu](https://eur-lex.europa.eu/eli/dir/2007/60/oj)
2. Real Decreto 903/2010, de 9 de julio, de evaluación y gestión de
   riesgos de inundación. *Boletín Oficial del Estado*, 171, 15 de julio de
   2010. [boe.es](https://www.boe.es/eli/es/rd/2010/07/09/903)
3. MITECO. *Zonas inundables de origen marino*. Sistema Nacional de
   Cartografía de Zonas Inundables (SNCZI).
   [miteco.gob.es](https://www.miteco.gob.es/es/cartografia-y-sig/ide/descargas/costas-medio-marino/zi-origen-marino.html)
