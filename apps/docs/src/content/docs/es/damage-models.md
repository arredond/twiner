---
title: Modelos de daño
description: Los métodos de cálculo, las bases de datos de vulnerabilidad y los esquemas de clasificación de edificios que puede usar twinQUAKE, qué necesita y produce cada uno, y cómo se obtuvo cada uno.
---

Un escenario sísmico convierte el movimiento del suelo en daño a los
edificios mediante tres elecciones:

- un **modelo de daño**: el método de cálculo, que convierte el movimiento
  del suelo y los datos de vulnerabilidad de un edificio en la probabilidad
  de cada grado de daño;
- una **base de datos de vulnerabilidad**: de dónde proceden los datos de
  vulnerabilidad de cada clase de edificio;
- un **esquema de clasificación**: cómo se ha asignado a cada edificio una
  clase de la taxonomía de la base de datos.

Una combinación es válida si la base de datos aporta los datos que
necesita el modelo y el esquema da clases de la taxonomía de la base de
datos. Todos los esquemas se calculan de antemano para todos los
edificios, así que cambiar de esquema o de base de datos nunca traduce una
taxonomía a otra.

En la aplicación se elige la combinación en la tarjeta de twinQUAKE, en
**Modelo de daño**; cada base de datos usa su esquema por defecto. En la
API, con los parámetros `damage_model`, `vulnerability_db` y, si se
quiere, `classification` de
[`/scenarios/fault`](/docs/es/api/operations/run_fault_scenario/) o
[`/scenarios/manual`](/docs/es/api/operations/run_manual_scenario/);
[`GET /methods`](/docs/es/api/operations/list_methods/) devuelve todo lo de
esta página en formato legible por máquina.

| Modelo de daño | Base de datos | Clasificación (por defecto) | En la aplicación |
|---|---|---|---|
| `fragility` | `gem` | `gem_heuristic` | Curvas de fragilidad (GEM). **Por defecto** |
| `capacity_spectrum` | `gem` | `gem_heuristic` | Espectro de capacidad (curvas GEM) |
| `capacity_spectrum` | `risk_ue` | `risk_ue_feriche2012` | Espectro de capacidad (RISK-UE) |

Los niveles de probabilidad se aplican igual a todos: +1σ eleva todas las
medidas del movimiento del suelo, y "muy baja" presenta el grado de daño
del percentil 85 de la distribución que produzca el modelo (ver
[twinQUAKE](/docs/es/hazards/earthquake/#4-niveles-de-probabilidad)).

## Entradas y salidas

### Modelos de daño

| | **Funciones de fragilidad** (`fragility`) | **Espectro de capacidad** (`capacity_spectrum`) |
|---|---|---|
| Método | Lee las probabilidades de daño de cada edificio en una curva de fragilidad, con la medida de intensidad para la que está definida | Nivel II de RISK-UE: busca dónde se cruza la curva de capacidad del edificio con el espectro de demanda del lugar y aplica una fragilidad lognormal sobre ese desplazamiento |
| Datos de vulnerabilidad necesarios | Funciones de fragilidad por clase | Curvas de capacidad por clase |
| Movimiento del suelo necesario (por celda de 1 km) | PGA, SA(0,3 s), SA(0,6 s) o SA(1,0 s), según la clase | SA en el periodo elástico de cada clase; PGA y PGV (para el periodo de esquina del espectro) |
| Exposición necesaria (por edificio) | Clase en la taxonomía de la base de datos, plantas | Clase en la taxonomía de la base de datos, plantas |
| Salida (por edificio) | Probabilidad de sin daño, leve, moderado, extenso y completo | Igual, más el desplazamiento espectral del punto de desempeño |

Los dos producen los mismos grados de daño, así que el mapa, las
estimaciones de impacto, la lista de infraestructuras y la API funcionan
igual con cualquiera de ellos.

### Bases de datos de vulnerabilidad

| | **GEM** (`gem`) | **RISK-UE** (`risk_ue`) |
|---|---|---|
| Aporta | Funciones de fragilidad y curvas de capacidad | Solo curvas de capacidad |
| Taxonomía | Taxonomía de edificios de GEM | Tipologías de RISK-UE, con nivel de normativa y rango de altura |
| Clases con datos | Las tres clases usadas, de 1 a 12 plantas (mampostería hasta 5) | M1.2, M3.4, RC1 (sin normativa); RC1, RC3.1, RC3.2 (normativa baja); el resto usa la más cercana (ver abajo) |
| Cómo se obtuvo | Analíticamente: análisis dinámicos no lineales del sistema equivalente de un grado de libertad de cada clase con un gran conjunto de registros sísmicos [1] | Mecánicamente: análisis pushover de edificios europeos representativos por los socios de RISK-UE, idealizados como curvas bilineales [2] |
| Umbrales de daño (espectro de capacidad) | Los de RISK-UE (ver abajo) | Los de RISK-UE |
| Fuente y licencia | Martins y Silva (2021), [GitHub](https://github.com/lmartins88/global_fragility_vulnerability), CC BY-SA 4.0 | Informe WP4 de RISK-UE (2003), tablas 3.1-1 y 3.1-2 |

### Esquemas de clasificación

| | **Heurística GEM** (`gem_heuristic`) | **RISK-UE, Feriche et al. 2012** (`risk_ue_feriche2012`) |
|---|---|---|
| Taxonomía | GEM | RISK-UE |
| Atributos del edificio | Año de construcción, plantas | Año de construcción, plantas |
| Atributos del emplazamiento | Ninguno | Aceleración básica $a_b$ de la NCSE-02 en el municipio |
| Regla | Material y sistema según la época de construcción | Matriz de tipologías de Feriche et al. para Lorca [6]; nivel de normativa según la época y $a_b$ |
| Clases | 3, por número de plantas | 5 tipologías × 3 niveles de normativa × 3 rangos de altura |

La página de [twinQUAKE](/docs/es/hazards/earthquake/#5-exposición-y-clases-de-vulnerabilidad)
recoge las dos reglas completas. Cada esquema declara los atributos que
necesita, así que un despliegue en otro lugar puede activar solo los
esquemas que sus datos permiten.

## El modelo de espectro de capacidad

Es el método de nivel II de RISK-UE (LM2) [2, 3], de la misma familia que
el que usa MERISUR. Para cada clase de edificio parte de una **curva de
capacidad**: cuánta aceleración lateral $S_a$ resiste el sistema
equivalente de un grado de libertad del edificio a medida que crece su
desplazamiento $S_d$. Se idealiza como bilineal, con un punto de
plastificación $(D_y, A_y)$ y un desplazamiento último $D_u$.

**1. Periodo elástico.** A partir del punto de plastificación:

$$
T_e = 2\pi\sqrt{\frac{D_y}{A_y\,g}}
$$

**2. Demanda.** La aceleración espectral elástica del lugar, con un 5 % de
amortiguamiento, en ese periodo, $S_{ae} = SA(T_e)$, del mismo modelo de
movimiento del suelo que el resto del cálculo (Akkar et al. 2014, con la
amplificación local y el nivel de probabilidad elegido), y el periodo de
esquina del espectro, $T_C$, donde pasa de aceleración constante a
velocidad constante. $T_C$ se obtiene de la PGA y la PGV del propio lugar
con los factores medianos de amplificación espectral de Newmark y Hall para
un 5 % de amortiguamiento [4]:

$$
T_C = 2\pi\,\frac{1{,}65\,\text{PGV}}{2{,}12\,\text{PGA}}
$$

**3. Punto de desempeño.** El desplazamiento que el terremoto impone al
edificio, en forma cerrada para una curva elastoplástica perfecta (método
N2 [5], ecuaciones 3-16 a 3-18 del WP4 de RISK-UE). Con el desplazamiento
elástico $S_{de} = S_{ae}\,g\,(T_e/2\pi)^2$ y $R = S_{ae}/A_y$:

$$
S_d =
\begin{cases}
S_{de} & R \le 1 \text{ (elástico), o } T_e \ge T_C \text{ (igual desplazamiento)} \\[1ex]
D_y\left[(R-1)\,\dfrac{T_C}{T_e} + 1\right] & \text{en otro caso}
\end{cases}
$$

**4. Daño.** Fragilidad lognormal sobre el desplazamiento espectral:

$$
P(DS \ge ds_k \mid S_d) = \Phi\!\left(\frac{\ln(S_d / S_{d,k})}{\beta_k}\right)
$$

con los umbrales y dispersiones de RISK-UE, todos obtenidos de la propia
curva de capacidad (tabla 3.8 del WP4) [2]. Con la ductilidad última
$\mu_u = D_u/D_y$:

| Grado | Umbral $S_{d,k}$ | Dispersión $\beta_k$ |
|---|---|---|
| Leve | $0{,}7\,D_y$ | $0{,}25 + 0{,}07\ln\mu_u$ |
| Moderado | $D_y$ | $0{,}20 + 0{,}18\ln\mu_u$ |
| Extenso | $D_y + 0{,}25\,(D_u - D_y)$ | $0{,}10 + 0{,}40\ln\mu_u$ |
| Completo | $D_u$ | $0{,}15 + 0{,}50\ln\mu_u$ |

El daño moderado empieza en la plastificación. Es una definición más
exigente que la de las funciones de fragilidad de GEM (ver
[Comparación](#comparación-lorca-2011)).

## Las bases de datos de vulnerabilidad

### GEM: Martins y Silva (2021)

El modelo global de fragilidad y vulnerabilidad del Global Earthquake
Model [1]. Para cada clase de edificio de la taxonomía GEM, los autores:

1. construyeron una curva de capacidad a partir de las propiedades
   estructurales de la clase;
2. hicieron análisis dinámicos no lineales de su sistema equivalente de un
   grado de libertad con un gran conjunto de registros sísmicos;
3. ajustaron funciones de fragilidad al daño resultante, con la medida de
   intensidad que mejor lo predecía.

TWIN-ER usa tres clases (ver
[twinQUAKE](/docs/es/hazards/earthquake/#5-exposición-y-clases-de-vulnerabilidad)).
El modelo de **fragilidad** lee directamente sus funciones de fragilidad. El
de **espectro de capacidad** usa sus curvas de capacidad publicadas, que
tienen cuatro puntos: origen, fisuración, plastificación y último. TWIN-ER
toma el punto de plastificación como $(D_y, A_y)$ y el último como $D_u$.
Las clases de mampostería llegan hasta 5 plantas; los edificios de
mampostería más altos usan la curva de 5 plantas.

### RISK-UE (2003)

RISK-UE (*An advanced approach to earthquake risk scenarios with
applications to different European towns*, contrato de la UE
EVK4-CT-2000-00014) desarrolló modelos de vulnerabilidad para tipologías
constructivas europeas [2]. Sus socios obtuvieron curvas de capacidad
mediante análisis pushover de modelos de edificios representativos:

- la Universidad de Génova (UNIGE) para la mampostería sin armar;
- la Universidad Aristóteles de Tesalónica (AUTh) para el hormigón armado.

Las curvas están tabuladas por tipología, rango de altura y nivel de
normativa sísmica.

TWIN-ER asigna a cada edificio una tipología, un nivel de normativa y un
rango de altura de RISK-UE con el esquema `risk_ue_feriche2012` (ver
[twinQUAKE](/docs/es/hazards/earthquake/#clases-risk-ue-risk_ue_feriche2012)).
Los parámetros usados, de las tablas 3.1-1 (sin normativa) y 3.1-2
(normativa baja) del WP4:

| Tipología | Normativa | $D_y$ (cm) | $A_y$ (g) | $D_u$ (cm) | $T_e$ (s) | Fuente |
|---|---|---|---|---|---|---|
| M1.2 L / M / H | Sin | 0,15 / 0,31 / 0,48 | 0,150 / 0,120 / 0,100 | 1,55 / 1,69 / 1,85 | 0,20 / 0,32 / 0,44 | UNIGE |
| M3.4 L / M / H | Sin | 0,53 / 0,75 / 0,92 | 0,297 / 0,149 / 0,099 | 3,18 / 3,47 / 3,67 | 0,27 / 0,45 / 0,61 | UNIGE |
| RC1 L / M / H | Sin | 0,77 / 2,21 / 3,86 | 0,187 / 0,156 / 0,073 | 4,47 / 8,79 / 11,48 | 0,41 / 0,76 / 1,46 | UNIGE |
| RC1 L / M / H | Baja | 2,32 / 4,27 / 5,76 | 0,192 / 0,170 / 0,124 | 9,58 / 10,77 / 14,83 | 0,70 / 1,01 / 1,37 | AUTh |
| RC3.1 L / M / H | Baja | 0,44 / 0,85 / 2,14 | 1,541 / 0,808 / 0,455 | 1,87 / 2,63 / 5,98 | 0,11 / 0,21 / 0,44 | AUTh |
| RC3.2 L / M / H | Baja | 1,63 / 1,90 / 2,26 | 0,182 / 0,198 / 0,253 | 6,37 / 7,87 / 7,80 | 0,60 / 0,62 / 0,60 | AUTh |

El WP4 da también una curva de M1.2 de baja altura obtenida por AUTh;
TWIN-ER usa la de UNIGE, para que todas las curvas de mampostería procedan
del mismo socio y método.

**Las curvas que faltan se sustituyen por la más cercana disponible.** El
WP4 no tabula una curva para cada tipología y nivel de normativa que
asigna el esquema. En esos casos TWIN-ER usa la curva disponible más
cercana, y lo indica:

| Asignada | Usa | Motivo |
|---|---|---|
| M3.1, sin normativa | M1.2, sin normativa | El WP4 no tiene curva de M3.1. M1.2 (mampostería de piedra simple) tiene el mismo índice de vulnerabilidad de nivel I, $V^* = 0{,}74$ (tabla 2.2 del WP4) |
| RC3.1, sin normativa o normativa media | RC3.1, normativa baja | RC3.1 solo está tabulada con normativa baja |
| RC3.2, sin normativa o normativa media | RC3.2, normativa baja | RC3.2 solo está tabulada con normativa baja |

Las sustituciones importan. El RC3.x de normativa media, todo edificio
desde 1997 en un municipio sísmico, usa curvas de normativa baja, así que
probablemente se **sobrestima** su vulnerabilidad. El RC3.x sin
normativa, de los mismos años donde $a_b < 0{,}04$ g, probablemente se
subestima, aunque esas zonas apenas sufren movimiento.

La principal diferencia con GEM está en el hormigón. Los pórticos RC1 de
RISK-UE plastifican con aproximadamente un tercio de la aceleración que la
clase de hormigón de GEM (0,19 g frente a 0,56 g en edificios bajos), así
que resultan mucho más vulnerables. RC3.1, los pórticos con cerramientos
asignados a los edificios desde 2005, es en cambio muy rígido y
resistente. En mampostería, M3.4 se parece a la clase de mediados de siglo
de GEM (plastifica a 0,30 g frente a 0,29 g con dos plantas), mientras que
M1.2, usada para los edificios más antiguos, es más débil que el mampuesto
de GEM (0,15 g frente a 0,24 g).

## Comparación: Lorca 2011

El terremoto de Lorca de 2011 (Mw 5,2, modo manual) con cada método, en la
ciudad de Lorca (distrito censal 01 del INE, 7.001 edificios), la zona que
cubrió la inspección posterior al terremoto. Las cifras son recuentos
esperados (suma de probabilidades). Las probabilidades "baja" y "muy baja"
dan los mismos recuentos esperados.

| Nivel | Método | Leve | Moderado | Extenso | Completo | Algún daño | Moderado o superior |
|---|---|---|---|---|---|---|---|
| | **Observado** (de 7.890) | 4.035 | 1.328 | 689 *(moderado–grave)* | 329 *(demolidos)* | 81 % | 30 % |
| Alta | Fragilidad (GEM) | 1.670 | 142 | 25 | 11 | 26 % | 3 % |
| | Espectro de capacidad (GEM) | 1.537 | 1.582 | 572 | 216 | 56 % | 34 % |
| | Espectro de capacidad (RISK-UE) | 787 | 1.600 | 806 | 409 | 51 % | 40 % |
| Baja / muy baja | Fragilidad (GEM) | 3.263 | 868 | 283 | 241 | 67 % | 20 % |
| | Espectro de capacidad (GEM) | 1.061 | 2.689 | 1.689 | 888 | 90 % | 75 % |
| | Espectro de capacidad (RISK-UE) | 1.013 | 1.849 | 1.649 | 1.130 | 81 % | 66 % |

- **La probabilidad "baja" es la que tiene un movimiento del suelo igual al
  registrado en Lorca.** Con ella, el modelo de fragilidad se queda algo
  corto respecto al daño observado. Las dos variantes del espectro de
  capacidad lo superan: entre dos y tres veces la proporción observada con
  daño moderado o superior. La proporción de edificios con algún daño de
  RISK-UE coincide con el 81 % observado, pero demasiados llegan a daño
  moderado o superior.
- **Con probabilidad "alta", las variantes del espectro de capacidad son
  las que más se acercan a la proporción observada con daño moderado o
  superior** (34–40 % frente a 30 %), pero encuentran menos edificios
  dañados en total.
- **Las clases RISK-UE de la ciudad:** 2.029 M3.1, 707 M3.4, 1.120 RC1 sin
  normativa y 2.187 de normativa baja, 434 RC3.2 y 524 RC3.1 (ambas de
  normativa media, así que con curvas de normativa baja).
- **La mayor parte de la diferencia entre métodos procede de la definición
  de los grados de daño.** RISK-UE hace empezar el daño moderado en el
  desplazamiento de plastificación, mientras que las funciones de
  fragilidad de GEM usan umbrales más suaves.

Estos métodos son alternativas para comparar, no predicciones calibradas.
Las categorías de la inspección abarcan varios grados de la EMS-98, así que
no se corresponden una a una con los grados del modelo (ver
[twinQUAKE](/docs/es/hazards/earthquake/#validación-lorca-2011)).

## Limitaciones

- **Un único conjunto de umbrales de daño.** Con el modelo de espectro de
  capacidad, las dos bases de datos usan los umbrales de RISK-UE. Los
  umbrales propios de GEM, que harían coherente "espectro de capacidad
  (GEM)" con las funciones de fragilidad de GEM, aún no están
  implementados.
- **Curvas elastoplásticas perfectas.** El punto de desempeño en forma
  cerrada ignora el endurecimiento posterior a la plastificación
  ($A_u > A_y$).
- **Periodo de esquina a partir de la PGA y la PGV.** $T_C$ usa factores
  medianos de amplificación espectral, no la forma espectral completa del
  modelo de movimiento del suelo.
- **Las curvas de RISK-UE proceden de edificios prototipo italianos y
  griegos**, no españoles. RISK-UE tiene también curvas obtenidas para
  Barcelona (CIMNE) para algunas tipologías, que aún no se usan.
- **Los esquemas de clasificación son aproximados.** Se basan en el año de
  construcción y el número de plantas (y, en RISK-UE, en la zona sísmica).
  El esquema RISK-UE procede de Lorca y se aplica a toda España.
- **Algunas clases RISK-UE usan la curva de otra** (ver
  [arriba](#risk-ue-2003)): M3.1 usa M1.2, y RC3.x usa su curva de
  normativa baja con cualquier nivel de normativa.

## Referencias

1. Martins, L., & Silva, V. (2021). Development of a fragility and
   vulnerability model for global seismic risk analyses. *Bulletin of
   Earthquake Engineering*, 19, 6719–6745.
   [doi:10.1007/s10518-020-00885-1](https://doi.org/10.1007/s10518-020-00885-1)
2. Milutinovic, Z. V., & Trendafiloski, G. S. (2003). *RISK-UE, WP4:
   Vulnerability of current buildings*. RISK-UE project report,
   EVK4-CT-2000-00014.
3. Lagomarsino, S., & Giovinazzi, S. (2006). Macroseismic and mechanical
   models for the vulnerability and damage assessment of current
   buildings. *Bulletin of Earthquake Engineering*, 4(4), 415–443.
   [doi:10.1007/s10518-006-9024-z](https://doi.org/10.1007/s10518-006-9024-z)
4. Newmark, N. M., & Hall, W. J. (1982). *Earthquake Spectra and Design*.
   Earthquake Engineering Research Institute, Oakland, CA.
5. Fajfar, P. (2000). A nonlinear analysis method for performance-based
   seismic design. *Earthquake Spectra*, 16(3), 573–592.
   [doi:10.1193/1.1586128](https://doi.org/10.1193/1.1586128)
6. Feriche, M., Vidal, F., Alguacil, G., Navarro, M., & Aranda, C. (2012).
   Vulnerabilidad y daño en el terremoto de Lorca de 2011. *Física de la
   Tierra*, 24, 255–287.
