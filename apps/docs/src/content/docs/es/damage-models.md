---
title: Modelos de daño
description: Los métodos de cálculo y las bases de datos de vulnerabilidad que puede usar twinQUAKE, qué necesita y produce cada uno, y cómo se obtuvo cada base de datos.
---

Un escenario sísmico convierte el movimiento del suelo en daño a los
edificios mediante dos elecciones independientes:

- un **modelo de daño**: el método de cálculo, que convierte el movimiento
  del suelo y los datos de vulnerabilidad de un edificio en la probabilidad
  de cada grado de daño;
- una **base de datos de vulnerabilidad**: de dónde proceden los datos de
  vulnerabilidad de cada clase de edificio.

Una combinación es válida si la base de datos aporta los datos que
necesita el modelo. En la aplicación se elige en la tarjeta de twinQUAKE,
en **Modelo de daño**. En la API, con los parámetros `damage_model` y
`vulnerability_db` de
[`/scenarios/fault`](/docs/es/api/operations/run_fault_scenario/) o
[`/scenarios/manual`](/docs/es/api/operations/run_manual_scenario/);
[`GET /methods`](/docs/es/api/operations/list_methods/) devuelve todo lo de
esta página en formato legible por máquina.

| Modelo de daño | Base de datos | En la aplicación |
|---|---|---|
| `fragility` | `gem` | Curvas de fragilidad (GEM). **Por defecto** |
| `capacity_spectrum` | `gem` | Espectro de capacidad (curvas GEM) |
| `capacity_spectrum` | `risk_ue` | Espectro de capacidad (RISK-UE) |

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
| Exposición necesaria (por edificio) | Clase de vulnerabilidad, clase de altura | Clase de vulnerabilidad, clase de altura |
| Salida (por edificio) | Probabilidad de sin daño, leve, moderado, extenso y completo | Igual, más el desplazamiento espectral del punto de desempeño |

Los dos producen los mismos grados de daño, así que el mapa, las
estimaciones de impacto, la lista de infraestructuras y la API funcionan
igual con cualquiera de ellos.

### Bases de datos de vulnerabilidad

| | **GEM** (`gem`) | **RISK-UE** (`risk_ue`) |
|---|---|---|
| Aporta | Funciones de fragilidad y curvas de capacidad | Solo curvas de capacidad |
| Clases | Las tres clases de TWIN-ER directamente, de 1 a 12 plantas (mampostería hasta 5) | Asignadas a partir de las clases de TWIN-ER (ver abajo), por rango de altura |
| Cómo se obtuvo | Analíticamente: análisis dinámicos no lineales del sistema equivalente de un grado de libertad de cada clase con un gran conjunto de registros sísmicos [1] | Mecánicamente: análisis pushover de edificios europeos representativos por los socios de RISK-UE, idealizados como curvas bilineales [2] |
| Umbrales de daño (espectro de capacidad) | Los de RISK-UE (ver abajo) | Los de RISK-UE |
| Fuente y licencia | Martins y Silva (2021), [GitHub](https://github.com/lmartins88/global_fragility_vulnerability), CC BY-SA 4.0 | Informe WP4 de RISK-UE (2003), tablas 3.1-1 y 3.1-2 |

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

Las tipologías de RISK-UE son más detalladas que lo que permite distinguir
el catastro. TWIN-ER asigna a cada una de sus clases la más parecida:

| Clase de TWIN-ER | Tipología RISK-UE | Nivel de normativa | Rangos de altura |
|---|---|---|---|
| `CR_LDUAL-DUL` (hormigón, 1970 o posterior) | RC1: pórticos de hormigón armado | Bajo | L 1–2, M 3–5, H 6+ plantas |
| `MUR_LWAL-DNO` (mampostería, 1940–1969) | M3.4: mampostería sin armar con forjados de hormigón | Sin normativa | L, M, H |
| `MUR-STRUB_LWAL-DNO` (mampostería, antes de 1940) | M1.1: mampostería de piedra (mampuesto) | Sin normativa | L, M, H |

Los parámetros usados, de las tablas 3.1-1 y 3.1-2 del WP4:

| Tipología | $D_y$ (cm) | $A_y$ (g) | $D_u$ (cm) | $T_e$ (s) | Fuente |
|---|---|---|---|---|---|
| M1.1 L / M / H | 0,38 / 0,47 / 0,66 | 0,173 / 0,115 / 0,058 | 1,93 / 2,03 / 2,28 | 0,30 / 0,41 / 0,68 | UNIGE |
| M3.4 L / M / H | 0,53 / 0,75 / 0,92 | 0,297 / 0,149 / 0,099 | 3,18 / 3,47 / 3,67 | 0,27 / 0,45 / 0,61 | UNIGE |
| RC1 L / M / H | 2,32 / 4,27 / 5,76 | 0,192 / 0,170 / 0,124 | 9,58 / 10,77 / 14,83 | 0,70 / 1,01 / 1,37 | AUTh |

La principal diferencia con GEM está en el hormigón: los pórticos de
hormigón de normativa baja de RISK-UE plastifican con aproximadamente un
tercio de la aceleración que los de GEM (0,19 g frente a 0,56 g en edificios
bajos), así que resultan mucho más vulnerables. Las curvas de mampostería
son parecidas a las de GEM.

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
| | Espectro de capacidad (RISK-UE) | 1.047 | 1.557 | 794 | 332 | 53 % | 38 % |
| Baja / muy baja | Fragilidad (GEM) | 3.263 | 868 | 283 | 241 | 67 % | 20 % |
| | Espectro de capacidad (GEM) | 1.061 | 2.689 | 1.689 | 888 | 90 % | 75 % |
| | Espectro de capacidad (RISK-UE) | 859 | 1.707 | 1.689 | 1.124 | 77 % | 65 % |

- **La probabilidad "baja" es la que tiene un movimiento del suelo igual al
  registrado en Lorca.** Con ella, el modelo de fragilidad se queda algo
  corto respecto al daño observado. Las dos variantes del espectro de
  capacidad lo superan: entre dos y tres veces la proporción observada con
  daño moderado o superior.
- **Con probabilidad "alta", las variantes del espectro de capacidad
  coinciden con la proporción observada con daño moderado o superior**
  (34–38 % frente a 30 %), pero encuentran menos edificios dañados en
  total.
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
- **La asignación de clases es aproximada**, como las propias clases: solo
  se basa en el año de construcción y el número de plantas.

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
