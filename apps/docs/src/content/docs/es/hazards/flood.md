---
title: twinFLOOD
description: Cómo estima TWIN-ER la exposición a inundaciones fluviales a partir de las zonas inundables oficiales del MITECO.
---

twinFLOOD muestra qué edificios, personas e infraestructuras críticas están
dentro de las **zonas inundables fluviales oficiales** para un periodo de
retorno y una zona elegidos. Después los resume por sección censal y
municipio, con las mismas unidades que un escenario sísmico.

A diferencia de [twinQUAKE](/docs/es/hazards/earthquake/), twinFLOOD no
ejecuta un modelo físico propio. España ya dispone de una cartografía de
inundaciones oficial y homogénea en todo el país, obtenida con modelos
hidrológicos e hidráulicos. El trabajo de TWIN-ER es cruzar esos mapas con
el parque de edificios y el censo, edificio a edificio, en todo el país.

## Los mapas de inundación: el SNCZI

La Directiva europea de inundaciones (2007/60/CE) [1], transpuesta al
derecho español por el Real Decreto 903/2010 [2], obliga a cartografiar las
zonas que los ríos inundan con determinadas probabilidades. Los mapas los
elaboran el Ministerio para la Transición Ecológica y el Reto Demográfico
(MITECO) y los organismos de cuenca, y se publican en el **Sistema Nacional
de Cartografía de Zonas Inundables (SNCZI)** [3].

Las manchas de inundación proceden de:

- estudios hidrológicos de los caudales de diseño;
- modelos hidráulicos de cómo se extiende ese caudal sobre el terreno,
  ejecutados sobre un modelo digital del terreno LiDAR de alta resolución
  (malla de 2 m).

TWIN-ER usa las manchas de inundación del segundo ciclo de planificación
para cuatro periodos de retorno: 10, 50, 100 y 500 años.

### Periodos de retorno

El **periodo de retorno** $T$ es el intervalo medio entre inundaciones de al
menos ese tamaño. Su probabilidad anual de superación es $p = 1/T$. La
probabilidad de que ocurra al menos una en $N$ años es:

$$
P(\text{al menos una en } N \text{ años}) = 1 - \left(1 - \frac{1}{T}\right)^{N}
$$

| Periodo de retorno | Probabilidad anual | En 30 años | En 100 años | Categoría en el SNCZI |
|---|---|---|---|---|
| T = 10 años | 10 % | 96 % | ≈100 % | Alta probabilidad |
| T = 50 años | 2 % | 45 % | 87 % | Inundación frecuente |
| T = 100 años | 1 % | 26 % | 63 % | Probabilidad media u ocasional |
| T = 500 años | 0,2 % | 6 % | 18 % | Probabilidad baja o excepcional |

Una "avenida de 100 años" no es, por tanto, algo que ocurra una vez en la
vida: hay aproximadamente una posibilidad entre cuatro de que se produzca
en cualquier periodo de 30 años.

### Qué cubren los mapas

Las zonas inundables solo están cartografiadas en los tramos de río que ha
estudiado el MITECO, principalmente las áreas de riesgo potencial
significativo de inundación (ARPSI) identificadas en la evaluación
preliminar del riesgo. Eso supone aproximadamente un tercio de los ríos
principales de España, según el periodo de retorno. Además:

- los mapas solo cubren la **inundación fluvial**;
- en Canarias solo hay mapas para T = 100 y T = 500. No existen mapas de
  T = 10 ni T = 50 para las islas.

## Método

### 1. Preparación de las zonas inundables (offline)

Las manchas son polígonos muy detallados, trazados sobre el modelo del
terreno de 2 m; solo la capa de T = 10 tiene unos 94 millones de vértices.
TWIN-ER las procesa una vez, offline:

1. **Reparar.** Se reparan los polígonos no válidos, alrededor del 13 %.
2. **Simplificar.** Se simplifican con Douglas-Peucker y una tolerancia de
   1 m. Es la mitad de la malla del terreno y muy inferior a la escala de
   publicación de los mapas (1:25.000), y conserva aproximadamente el 15 %
   de los vértices.
3. **Cortar por sección censal.** Las zonas se cortan por los límites de
   las secciones censales del INE y se unen por sección y periodo de
   retorno. La unión elimina los solapes entre estudios del mismo tramo de
   río, que de otro modo contarían la superficie dos veces. Como cada
   sección pertenece a un único municipio, provincia y comunidad autónoma,
   la superficie inundada puede sumarse después con exactitud en todos los
   niveles.

### 2. Edificios en la zona inundable (offline)

Un edificio está **en la zona inundable** para el periodo de retorno $T$
cuando su **huella** interseca la zona de $T$. La prueba usa la huella, no
solo el centroide: un edificio alargado en la orilla puede tener el
centroide en seco y una fachada en el agua. Las infraestructuras críticas
pasan la misma prueba con su propia geometría.

La pertenencia a una zona inundable no depende del escenario, así que se
calcula una sola vez para los ~13 millones de edificios y los cuatro
periodos de retorno. Unos 660.000 edificios quedan dentro de alguna zona
inundable cartografiada en algún periodo de retorno.

### 3. Un escenario: periodo de retorno × zona (en cada petición)

Un escenario es un periodo de retorno más una zona:

- un **círculo** de hasta 200 km de radio, dibujado en el mapa; o
- una **unidad administrativa**: comunidad autónoma, provincia o
  municipio, elegida en el mapa o buscada por su nombre.

TWIN-ER selecciona los edificios inundables precalculados de esa zona y
los suma por sección censal y municipio. Incluso una zona grande se
resuelve en una fracción de segundo, porque no se recalcula geometría salvo
en las zonas que corta el borde de un círculo.

Las provincias sin mapa para el periodo de retorno elegido se indican como
**no cartografiadas**, no como no inundadas.

## Resultados

Para cada sección censal y municipio:

- edificios en la zona inundable, también en % de los edificios de la
  zona;
- viviendas en la zona inundable;
- residentes en la zona inundable, y cuántos son vulnerables (menores de 15
  años o de 65 y más);
- superficie inundada, en km².

Los hospitales, colegios, residencias, servicios de emergencia,
instalaciones eléctricas, puentes y presas dentro de la zona se listan
aparte. Las
[estimaciones de impacto](/docs/es/impact-estimates/#cifras-de-inundación)
recogen las fórmulas.

## Limitaciones

- **Cartografiado no es lo mismo que en riesgo.** Fuera de los tramos
  estudiados, "ningún edificio inundado" significa "sin mapa", no "sin
  riesgo".
- **Solo inundación fluvial.** No incluye las avenidas súbitas por lluvias
  intensas locales ni los desbordamientos del drenaje urbano. La inundación
  costera es [twinCOAST](/docs/es/hazards/coast/).
- **Extensión, no calado.** Sin calados ni velocidades no hay curvas
  calado-daño. twinFLOOD informa de la exposición (lo que queda dentro de
  la zona), no del daño, el coste ni los escombros.
- **Mapas estáticos.** Las zonas reflejan el terreno, las obras fluviales y
  el clima supuestos al modelarlas. No tienen en cuenta cambios
  posteriores ni escenarios de cambio climático.
- **Población nocturna.** Como en los terremotos, los residentes se sitúan
  por vivienda, no por dónde está la gente durante el día.

## Referencias

1. Parlamento Europeo y Consejo (2007). Directiva 2007/60/CE, de 23 de
   octubre de 2007, relativa a la evaluación y gestión de los riesgos de
   inundación. *Diario Oficial de la Unión Europea*, L 288, 27–34.
   [eur-lex.europa.eu](https://eur-lex.europa.eu/eli/dir/2007/60/oj)
2. Real Decreto 903/2010, de 9 de julio, de evaluación y gestión de
   riesgos de inundación. *Boletín Oficial del Estado*, 171, 15 de julio de
   2010. [boe.es](https://www.boe.es/eli/es/rd/2010/07/09/903)
3. MITECO. *Sistema Nacional de Cartografía de Zonas Inundables (SNCZI)*.
   Ministerio para la Transición Ecológica y el Reto Demográfico.
   [miteco.gob.es](https://www.miteco.gob.es/es/agua/temas/gestion-de-los-riesgos-de-inundacion/snczi.html)
