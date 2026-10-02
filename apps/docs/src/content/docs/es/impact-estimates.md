---
title: Estimaciones de impacto
description: Cómo convierte TWIN-ER el daño a los edificios o la exposición a la inundación en cifras por sección censal y municipio.
---

Tras ejecutar un escenario, TWIN-ER calcula un conjunto de cifras de
impacto para cada sección censal y municipio afectados. Esta página
explica cómo se calcula cada una.

:::caution[Estimaciones aproximadas y documentadas]
Son **órdenes de magnitud para comparar lugares y escenarios, no un modelo
de pérdidas calibrado**. Cada parámetro es una hipótesis en números
redondos o un valor genérico de la metodología estadounidense HAZUS [1],
adaptado a las clases de edificio de TWIN-ER. Ninguno se ha validado aún
con pérdidas observadas en España.
:::

## Datos de partida

Para cada edificio que evalúa, un escenario sísmico conoce la
probabilidad de cada grado de daño: Sin daño, Leve, Moderado, Extenso y
Completo (ver [twinQUAKE](/docs/es/hazards/earthquake/)). El modelo de exposición aporta
tres atributos más de cada edificio:

| Atributo | Origen |
|---|---|
| Sección censal | La sección censal del INE de 2025 que contiene el centroide del edificio o, si ninguna lo contiene, la más cercana de su propio municipio. |
| Viviendas | Número de viviendas catastrales. |
| Superficie construida | Superficie construida catastral, sumando todas las plantas. Los catastros forales no la publican, así que en el País Vasco y Navarra es la superficie de la huella × el número de plantas. |

El *Censo Anual de Población* del INE (1 de enero de 2025) da tres cifras
para cada sección censal [2]:

- la población residente;
- los residentes menores de 15 años;
- los residentes de 65 años y más.

Mientras se ejecuta un escenario, TWIN-ER suma edificios, viviendas y
superficie construida por sección censal y grado de daño. Cada edificio
cuenta en todos los grados **ponderado por su probabilidad** de estar en
cada uno. Un edificio con un 60 % de probabilidad de daño Leve y un 40 % de
Moderado suma 0,6 edificios a Leve y 0,4 a Moderado, y reparte del mismo
modo sus viviendas y su superficie. El resultado son **valores esperados**:
lo que vería la zona en promedio, teniendo en cuenta todo el rango de daño
que puede sufrir cada edificio.

- **Todas las cifras siguientes se derivan de esas sumas.** Las cifras de
  un municipio son la suma de las de sus secciones. Los porcentajes se
  recalculan a partir de las sumas, nunca se promedian.
- **Los edificios del mapa son distintos.** Cada edificio sigue mostrando
  un único grado de daño, elegido según el nivel de probabilidad: el más
  probable, o el del percentil 85 con probabilidad "muy baja". La API
  devuelve también los recuentos por zona según ese grado mostrado
  (`counts_reported`).
- **Las probabilidades "baja" y "muy baja" dan las mismas cifras por
  zona.** Las dos usan el mismo movimiento del suelo (mediana + 1σ) y solo
  difieren en qué grado único muestra cada edificio.

**Definiciones.**

- Un edificio está **afectado** cuando su grado de daño es cualquiera salvo
  "sin daño". Sus residentes están **desplazados** cuando el grado es
  Extenso o Completo. Ambos se cuentan por probabilidad, como arriba.
- Una zona se considera afectada si tiene al menos medio edificio dañado
  esperado, o algún edificio que el mapa muestra dañado. Por debajo, se
  presenta como sin daño.

## Cifras sísmicas

### Edificios afectados

El número de edificios afectados, y ese número en porcentaje de **todos**
los edificios de la zona (no solo de los evaluados por el escenario).

### Población afectada

El INE publica cuántas personas viven en cada sección, no en qué edificio.
TWIN-ER reparte los residentes de cada sección entre sus edificios **en
proporción a sus viviendas**:

$$
\text{Población afectada}_s = \text{Población}_s \times
\frac{\text{viviendas en edificios afectados}_s}{\text{todas las viviendas}_s}
$$

La población **desplazada** usa en su lugar las viviendas de los edificios
con daño Extenso o Completo.

Todos los residentes se reparten entre todas las viviendas catastrales,
incluidas las segundas residencias y las vacías. A escala nacional salen
1,92 residentes por vivienda catastral (49,1 millones de residentes, 25,6
millones de viviendas), por debajo de las aproximadamente 2,5 personas por
hogar ocupado. En secciones costeras y rurales con muchas segundas
residencias, la población queda por tanto más repartida de lo que está en
realidad.

Unas pocas secciones con población no tienen viviendas registradas en
ningún edificio. En ellas, los residentes se reparten por número de
edificios.

### Población vulnerable afectada

La población **vulnerable** (dependiente) son los residentes menores de 15
años o de 65 y más. Son los grupos de edad dependientes de la tasa de
dependencia de Eurostat; la del INE usa menores de 16, que los grupos
quinquenales del censo no permiten calcular.

$$
\text{Vulnerables afectados}_s = \text{Población afectada}_s \times
\frac{\text{menores de 15}_s + \text{65 y más}_s}{\text{Población}_s}
$$

Se supone que la estructura de edad de cada sección es la misma en todos
sus edificios.

### Coste material

$$
\text{Coste} = \sum_{ds} A_{ds} \times c \times r_{ds}
$$

donde:

- $A_{ds}$ es la superficie construida en el grado de daño $ds$;
- $c$ = 1.000 €/m² es el coste de reposición;
- $r_{ds}$ es el ratio de daño (coste de reparación ÷ coste de reposición).

| | Leve | Moderado | Extenso | Completo |
|---|---|---|---|---|
| Ratio de daño $r_{ds}$ | 2 % | 10 % | 43 % | 100 % |

- **Ratios de daño.** HAZUS-MH 2.1, tablas 15.2–15.4 [1]: los ratios
  estructurales más los no estructurales sensibles a la aceleración y a la
  deriva, para edificios residenciales. El ratio de daño Extenso es la
  media de la vivienda unifamiliar (44,7 %) y la plurifamiliar (41,3 %).
- **Coste de reposición.** 1.000 €/m² es una hipótesis en números redondos
  para demoler y reconstruir un edificio español medio, no una referencia
  española publicada. Los costes de construcción varían mucho por región y
  tipo, así que es el parámetro que más conviene sustituir.
- **No se incluyen** el contenido de los edificios, las pérdidas
  indirectas ni el encarecimiento de la construcción tras un desastre.

### Escombros

$$
\text{Escombros (t)} = \sum_{ds} A_{ds} \times w \times f_{ds}
$$

donde $w$ = 1,1 t/m² es el peso del edificio por unidad de superficie
construida y $f_{ds}$ es la fracción de ese peso que se convierte en
escombro:

| | Leve | Moderado | Extenso | Completo |
|---|---|---|---|---|
| Fracción de escombro $f_{ds}$ | 2 % | 10 % | 38 % | 100 % |

Ambos proceden de HAZUS-MH 2.1, tablas 12.1–12.3 [1]. Los valores quedan
entre el tipo HAZUS de pórtico de hormigón con relleno de fábrica (C3:
1,17 t/m²) y los de mampostería sin armar (URM: 0,88 t/m²), redondeados.
Las unidades de HAZUS (toneladas cortas por 1.000 pies²) se convierten a
toneladas por m².

Es una estimación de peso. Es distinta de las **envolventes de escombros**
del mapa, que muestran dónde pueden caer los escombros, no cuántos hay.

### Viajes de camión

$$
\text{Viajes} = \left\lceil \frac{\text{Escombros (t)}}{20\ \text{t}} \right\rceil
$$

20 t es la carga típica de un camión volquete rígido de 3–4 ejes. La cifra
solo cuenta viajes. No tiene en cuenta el volumen (el escombro voluminoso
puede llenar la caja antes de alcanzar el límite de peso), la distancia de
transporte ni la clasificación.

### Puntales

$$
\text{Puntales} = \sum_{ds} A_{ds} \times s_{ds} \times 1\ \text{puntal/m}^2
$$

donde $s_{ds}$ es la fracción de la superficie construida que necesita
apuntalamiento de emergencia:

| | Leve | Moderado | Extenso | Completo |
|---|---|---|---|---|
| Fracción a apuntalar $s_{ds}$ | 0 % | 5 % | 20 % | 0 % |

Estas fracciones son **hipótesis**, sin fuente publicada. El apuntalamiento
de emergencia de forjados suele colocar puntales cada metro,
aproximadamente. El daño Moderado puede necesitar apuntalamiento puntual, y
el Extenso más. Los edificios con daño Completo se demuelen en lugar de
apuntalarse.

## Cifras de inundación

Un escenario de inundación no tiene grados de daño: un edificio está o no
está en la zona inundable para el periodo de retorno elegido. Por eso no se
aplican las cifras basadas en el daño (coste, escombros, camiones,
puntales, desplazados). Harían falta calados y curvas calado-daño, que los
mapas oficiales no dan. Para cada sección censal, agregadas por municipio:

| Cifra | Cálculo |
|---|---|
| Edificios en zona inundable | Edificios cuya huella interseca la zona; también en % de todos los edificios de la sección. |
| Viviendas en zona inundable | Suma de las viviendas de esos edificios. |
| Residentes en zona inundable | Población de la sección × viviendas en la zona ÷ todas las viviendas de la sección, como arriba. |
| Residentes vulnerables | Residentes en la zona × la fracción de menores de 15 y mayores de 64 de la sección. |
| Superficie inundada | Superficie de la zona inundable dentro de la sección, y dentro del círculo si se ha dibujado uno, en km². |

"No cartografiado" no es "no inundado". Consulta
[twinFLOOD](/docs/es/hazards/flood/) para saber qué cubren los mapas. Los
escenarios de inundación costera ([twinCOAST](/docs/es/hazards/coast/))
dan las mismas cifras, para la zona inundable costera.

## Limitaciones

- **Un coste y un peso por m² para todos los edificios.** Una nave
  industrial pesa y cuesta mucho menos por m² que una vivienda. Separar por
  clase y uso es la mejora más evidente.
- **Solo población nocturna.** No hay modelo de ocupación diurna.
- **Sin bandas de incertidumbre.** Las cifras son valores esperados,
  promedios sobre la distribución de daño de cada edificio, sin un rango
  alrededor. Además, el daño se trata como independiente de un edificio a
  otro.

## Referencias

1. FEMA (2012). *Multi-hazard Loss Estimation Methodology, Earthquake
   Model: Hazus-MH 2.1 Technical Manual*. Federal Emergency Management
   Agency, Washington, DC.
2. INE. *Censo Anual de Población 2021–2025*. Instituto Nacional de
   Estadística. [ine.es](https://www.ine.es/)
