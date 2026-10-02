---
title: twinQUAKE
description: Cómo simula TWIN-ER un escenario sísmico, desde la ruptura de la falla hasta el grado de daño de cada edificio.
---

twinQUAKE simula un **escenario sísmico determinista**: un terremoto
concreto, en una falla o en un punto que tú defines. Estima el daño que ese
terremoto causaría en cada edificio a su alcance y agrega los resultados en
cifras de impacto por sección censal y municipio.

Sigue la cadena habitual de la evaluación del riesgo sísmico por
escenarios, tal como la implementan MERISUR [1] y herramientas como
OpenQuake Engine [2]:

1. **Fuente.** Dónde se rompe la falla, con qué magnitud y con qué
   mecanismo.
2. **Movimiento del suelo.** Con qué intensidad tiembla el suelo en cada
   edificio, según un modelo de movimiento del suelo.
3. **Amplificación local.** Cuánto amplifica ese movimiento el suelo de
   cada lugar.
4. **Nivel de probabilidad.** Qué parte del rango de incertidumbre se
   presenta.
5. **Exposición y vulnerabilidad.** A qué clase estructural pertenece cada
   edificio, en el esquema de clasificación elegido.
6. **Daño.** La probabilidad de que cada edificio alcance cada grado de
   daño con ese movimiento, con el modelo de daño elegido.
7. **Impacto.** Qué suponen esos grados de daño en personas, coste,
   escombros e infraestructuras críticas.

Un escenario típico evalúa entre cientos de miles y unos pocos millones de
edificios en pocos segundos.

## 1. Fuente: la ruptura

Hay dos formas de definir el terremoto.

### Modo automático: el terremoto máximo de una falla activa

Eliges una falla de la **base de datos de fallas activas del Cuaternario de
Iberia (QAFI v4)**, elaborada por el Instituto Geológico y Minero de España
(IGME) [3]. Recoge 201 fallas activas en España, cada una con su traza en
superficie, buzamiento, ángulo de deslizamiento (*rake*) y rango de
profundidad sismogénica. TWIN-ER simula el **terremoto máximo** de la
falla: la mayor magnitud que se considera capaz de generar.

- **Magnitud.** 120 de las 201 fallas tienen una magnitud máxima publicada
  en la literatura y recogida en QAFI. Para las otras 81 se estima a partir
  de la longitud de la traza con la relación de Wells y Coppersmith (1994)
  para todos los tipos de falla [4]:

  $$
  M_w = 5{,}08 + 1{,}16 \log_{10}(L)
  $$

  donde $L$ es la longitud de ruptura en superficie, en km. Así se supone
  que toda la traza cartografiada rompe a la vez, lo que sobrestima la
  magnitud de una falla larga que suele romper por segmentos.
- **Geometría.** La ruptura es un **plano finito**, no un punto. Se
  construye proyectando la traza de la falla en profundidad, con su ángulo
  de buzamiento, desde el techo hasta la base de su rango de profundidad
  sismogénica. El plano se discretiza en una malla de 2 km con la clase
  `SimpleFaultSurface` de OpenQuake [2]. Las distancias se miden al punto
  más cercano del plano, de modo que el movimiento sigue siendo intenso a
  lo largo de toda la falla y no solo cerca de su punto medio.
- **Mecanismo.** El *rake* de QAFI, según el convenio de Aki y Richards:
  0° desgarre, 90° inversa, −90° normal.

### Modo manual: un terremoto definido por ti

Haces clic en un punto y eliges la magnitud. Opcionalmente puedes indicar
también el tipo de falla (desgarre, normal o inversa) o, con control total,
la dirección (*strike*), el buzamiento y la profundidad del techo de la
ruptura.

- Con solo la ubicación y la magnitud, la ruptura es una **fuente puntual**
  y las distancias se miden al epicentro.
- Con dirección, buzamiento y profundidad, TWIN-ER construye un **plano
  finito** centrado en el epicentro. Su longitud $L$ y su anchura $W$ en
  buzamiento (km) salen de Wells y Coppersmith (1994):

  $$
  \log_{10} L = \frac{M_w - 4{,}38}{1{,}49}, \qquad \log_{10} W = -1{,}01 + 0{,}32\,M_w
  $$

## 2. Movimiento del suelo

El movimiento del suelo se estima con el modelo (GMPE) de **Akkar,
Sandıkkaya y Bommer (2014)** [5]. Se obtuvo a partir de registros de
movimiento fuerte de terremotos corticales en Europa y Oriente Medio, y es
el que usaba MERISUR. TWIN-ER lo evalúa con la implementación de la
biblioteca `hazardlib` de OpenQuake [2] (`AkkarEtAlRjb2014`).

El modelo predice el logaritmo natural de una medida de intensidad $Y$ como
un término de roca de referencia más un término de suelo, con una
dispersión lognormal:

$$
\ln Y = \ln Y_{\text{ref}}(M_w, R_{JB}, \text{SoF}) + \ln S(V_{S30}, \text{PGA}_{\text{ref}}) + \varepsilon\,\sigma
$$

Para magnitudes hasta el punto de inflexión $c_1 = 6{,}75$, el término de
referencia es

$$
\begin{aligned}
\ln Y_{\text{ref}} = {} & a_1 + a_2 (M_w - c_1) + a_3 (8{,}5 - M_w)^2 \\
& + \left[a_4 + a_5 (M_w - c_1)\right] \ln\sqrt{R_{JB}^2 + a_6^2} + a_8 F_N + a_9 F_R
\end{aligned}
$$

Por encima del punto de inflexión, $a_7$ sustituye a $a_2$. En estas
ecuaciones:

- $R_{JB}$ es la **distancia de Joyner-Boore**: la distancia horizontal
  desde el emplazamiento a la proyección en superficie del plano de
  ruptura, o al epicentro en una fuente puntual.
- $F_N$ y $F_R$ indican un mecanismo normal o inverso. El desgarre es la
  referencia.
- $a_1 \ldots a_9$ son coeficientes que dependen del periodo, tabulados en
  [5].
- $\sigma$ es la desviación típica total del modelo, que combina la
  variabilidad entre terremotos y dentro de un mismo terremoto. Vale
  aproximadamente 0,7–0,8 en unidades de logaritmo natural para las
  medidas de intensidad usadas aquí, así que una desviación típica equivale
  aproximadamente a multiplicar el movimiento por dos.

**Medidas de intensidad.** Los edificios de distinta altura responden a
frecuencias de vibración distintas, y cada modelo de daño (paso 6) lee el
movimiento del suelo de forma distinta. TWIN-ER calcula solo lo que
necesita el modelo elegido:

| Modelo de daño | Medidas de intensidad |
|---|---|
| Funciones de fragilidad | La que define la curva de cada edificio: aceleración máxima del suelo (PGA) en edificios de 1 planta de hormigón y de mampuesto; aceleración espectral SA(0,3 s) en mampostería de 1–3 plantas (2–3 en mampuesto) y hormigón de 2–4; SA(0,6 s) en mampostería de 4–5 plantas y hormigón de 5–7; SA(1,0 s) en hormigón de 8–12 |
| Espectro de capacidad | SA en el periodo elástico de cada clase, más PGA y velocidad máxima del suelo (PGV) para el periodo de esquina del espectro |
| Todos | PGV, para la intensidad macrosísmica (paso 7) |

**Malla de cálculo.** El modelo varía suavemente con la distancia. Por eso
el movimiento del suelo se calcula una vez por celda ocupada de una malla
de 1 km, y no una vez por edificio, lo que divide el cálculo entre 40 y 50.
Frente al cálculo edificio a edificio, el error medio es de unos 0,001 g y
menos del 3 % en el percentil 99, muy por debajo de la propia dispersión
del modelo.

**Radio de búsqueda.** Un escenario solo evalúa los edificios lo bastante
cerca como para importar. El radio es la distancia a la que SA(0,3 s), con
el nivel de probabilidad elegido, baja de 0,02 g, muy por debajo del
movimiento al que las funciones de fragilidad predicen daño. El radio se
limita a entre 10 y 300 km, y es el mismo para todos los modelos de daño.

## 3. Amplificación local

Los suelos blandos amplifican el movimiento: el terremoto de Lorca de 2011
causó la mayor parte de sus daños sobre los sedimentos del valle del
Guadalentín. El modelo de Akkar et al. representa el suelo mediante
$V_{S30}$, la velocidad media de las ondas de cizalla en los 30 m
superiores, con un término de suelo no lineal de Sandıkkaya et al. (2013)
[6]. Amplifica más los movimientos débiles que los fuertes:

$$
\ln S =
\begin{cases}
b_1 \ln\!\left(\dfrac{V_{S30}}{V_{\text{ref}}}\right)
+ b_2 \ln\!\left[\dfrac{\text{PGA}_{\text{ref}} + c\,(V_{S30}/V_{\text{ref}})^{n}}{(\text{PGA}_{\text{ref}} + c)\,(V_{S30}/V_{\text{ref}})^{n}}\right]
& V_{S30} < V_{\text{ref}} \\[2ex]
b_1 \ln\!\left(\dfrac{\min(V_{S30}, V_{\text{con}})}{V_{\text{ref}}}\right) & V_{S30} \ge V_{\text{ref}}
\end{cases}
$$

donde:

- $V_{\text{ref}} = 750$ m/s y $V_{\text{con}} = 1000$ m/s;
- $c = 2{,}5$ y $n = 3{,}2$;
- $\text{PGA}_{\text{ref}}$ es la PGA que predice el modelo en roca de
  referencia en ese mismo lugar.

La $V_{S30}$ de cada edificio procede del modelo de suelo del **Modelo
Europeo de Riesgo Sísmico 2020 (ESRM20)** [7, 8]. Es una malla de unos 30
segundos de arco (≈ 800 m) inferida sobre todo a partir de la pendiente
topográfica y la geología [9], con valores medidos donde los hay. En Lorca
da entre 258 y 641 m/s (mediana de 388 m/s) en los edificios de la ciudad,
lo que coincide con las clases de suelo del Eurocódigo 8 que los estudios
geofísicos locales encontraron en los barrios más dañados.

La malla no cubre Canarias. Los edificios de las islas, como cualquier
lugar al que no llegue la malla, usan $V_{S30} = 800$ m/s (roca, sin
amplificación).

## 4. Niveles de probabilidad

Un modelo de movimiento del suelo no predice un valor único, sino una
distribución, y todos los modelos de daño predicen también una
distribución de daño. Como MERISUR, TWIN-ER ofrece tres **niveles de
probabilidad**. Cada uno lee un punto distinto de esas dos distribuciones
[1]:

| Nivel | Movimiento del suelo | Grado de daño mostrado por edificio |
|---|---|---|
| **Alta** probabilidad | Mediana: $\varepsilon = 0$ | El más probable (modal) |
| **Baja** probabilidad | Mediana + 1σ: $\varepsilon = 1$ | El más probable (modal) |
| **Muy baja** probabilidad | Mediana + 1σ: $\varepsilon = 1$ | Percentil 85 |

El grado del percentil 85 es el grado menos severo $ds$ cuya probabilidad
acumulada alcanza 0,85:

$$
ds_{85} = \min\Big\{ ds : \sum_{d \le ds} P(DS = d) \ge 0{,}85 \Big\}
$$

Así, como mucho un 15 % de la probabilidad corresponde a grados más
severos que el presentado. "Muy baja probabilidad" significa por tanto un
resultado pesimista pero plausible, no el peor caso.

La columna del grado de daño se aplica a **cada edificio**: el único grado
con el que se colorea en el mapa. Las cifras de **secciones censales y
municipios** son en cambio valores esperados, que suman la probabilidad de
cada grado de daño de todos los edificios (ver el [paso 8](#8-impacto)).
"Baja" y "muy baja" comparten el mismo movimiento del suelo, así que dan
las mismas cifras por zona y solo difieren en el grado que muestra cada
edificio.

El nivel importa mucho. En el terremoto de Lorca de 2011, el movimiento
mediano se queda muy por debajo de lo registrado cerca de la falla. La
mediana + 1σ queda a pocos puntos porcentuales de la aceleración máxima
registrada (ver [validación](#validación-lorca-2011)).

## 5. Exposición y clases de vulnerabilidad

La **exposición** es el conjunto de edificios en riesgo. TWIN-ER toma cada
edificio del catastro: el servicio INSPIRE de la Dirección General del
Catastro, más los catastros forales de Álava, Gipuzkoa, Bizkaia y Navarra.
Cada registro da la huella, el número de plantas, el año de construcción,
las viviendas y la superficie construida. Son unos 13 millones de
edificios en total.

La **clase de vulnerabilidad** de un edificio es la tipología estructural
que determina cómo responde al movimiento. Un modelo nacional no puede
basarse en trabajo de campo, así que TWIN-ER asigna las clases a partir de
los atributos catastrales con información estructural (año de
construcción y número de plantas) y, en uno de los esquemas, de la zona
sísmica en la que está el edificio.

Cada base de datos de vulnerabilidad está indexada por su propia
**taxonomía**: la taxonomía de edificios de GEM [10] o las tipologías de
RISK-UE [16]. En lugar de traducir una taxonomía a otra, TWIN-ER calcula
de antemano cada **esquema de clasificación** y guarda la clase de cada
edificio en todos ellos. Un escenario lee la clase del esquema que
corresponde a la base de datos elegida (ver
[Modelos de daño](/docs/es/hazards/earthquake/damage-models/#esquemas-de-clasificación)):

| Esquema | Taxonomía | Usa | Versión | Por defecto para |
|---|---|---|---|---|
| `gem_heuristic` | GEM | Año de construcción, plantas | `heuristic_v2` | `gem` (y el escenario por defecto) |
| `risk_ue_feriche2012` | RISK-UE | Año de construcción, plantas, aceleración básica de la NCSE-02 | `feriche2012_v1` | `risk_ue` |

Ambos son estimaciones informadas, no observaciones, y se guardan
versionados en cada edificio. El Catastro no registra el sistema
estructural, la ductilidad ni los refuerzos.

### Clases GEM (`gem_heuristic`)

| Año de construcción | Clase | Descripción |
|---|---|---|
| 1970 o posterior | `CR_LDUAL-DUL` | Hormigón armado, sistema dual pórtico-muro, ductilidad baja |
| 1940–1969 | `MUR_LWAL-DNO` | Mampostería sin armar, muros de carga, no dúctil |
| Antes de 1940, o desconocido | `MUR-STRUB_LWAL-DNO` | Mampostería de piedra sin armar (mampuesto), muros de carga, no dúctil |

- **1970** marca aproximadamente la generalización de las estructuras de
  hormigón armado y de las primeras normas sismorresistentes españolas.
- **1940** separa la mampostería tradicional más antigua, normalmente de
  mampuesto como la del casco histórico de Lorca, de la mampostería de
  mediados de siglo.
- Si el año es desconocido, el edificio recibe la clase **más vulnerable**.

La **clase de altura** es el número de plantas, de 1 a 12. Las clases de
mampostería solo tienen datos de vulnerabilidad de GEM hasta 5 plantas,
así que los edificios de mampostería más altos usan las funciones de
fragilidad y curvas de capacidad de 5 plantas.

### Clases RISK-UE (`risk_ue_feriche2012`)

Tras el terremoto de Lorca de 2011, Feriche et al. [15] elaboraron una
matriz de tipologías de edificios para Lorca que asigna una tipología de
RISK-UE a partir del año de construcción catastral, contrastada con las
inspecciones de daños de la ciudad. TWIN-ER la aplica a todos los
edificios de España:

| Año de construcción | Tipología RISK-UE | Descripción (Feriche et al., tabla 5) |
|---|---|---|
| 1945 o anterior, o desconocido | M3.1 | Muros de carga de mampostería o fábrica de ladrillo, forjados de madera |
| 1946–1959 | M3.4 | Fábrica de ladrillo con forjados de hormigón armado |
| 1960–1996 | RC1 | Pórticos de hormigón (vigas descolgadas hasta 1977; después vigas planas o forjado reticular) |
| 1997–2004 | RC3.2 | Pórticos de hormigón con vigas planas o forjado reticular, irregulares (NCSE-94) |
| 2005 o posterior | RC3.1 | Pórticos de hormigón con vigas planas o forjado reticular, o acero (NCSE-02) |

El **nivel de código sísmico** sigue la historia de las normas españolas
(Feriche et al., tabla 2): la mampostería es siempre anterior a código
(*pre-code*); el hormigón es anterior a código antes de 1970, de código
bajo de 1970 a 1996 (PGS-1, PDS-1) y de código medio desde 1997 (NCSE-94,
NCSE-02). Donde el municipio del edificio tiene una **aceleración sísmica
básica** $a_b$ inferior a 0,04 g en la norma vigente, la NCSE-02 [17],
la norma no exige diseño sismorresistente, así que el edificio es anterior
a código sea cual sea su año. TWIN-ER toma $a_b$ del anejo 1 de la
NCSE-02, emparejado con los municipios actuales; 2.613 municipios, con el
52 % de los edificios, tienen $a_b \ge 0{,}04$ g.

La **banda de altura** es la de RISK-UE: baja (1–2 plantas), media (3–5)
o alta (6 o más).

:::caution[Calibrado en Lorca, aplicado a todo el país]
La matriz de Feriche et al. describe la historia constructiva de Lorca.
Usarla en todas partes supone que cada época construyó igual en toda
España, algo plausible en la España mediterránea y menos en otras
regiones. La regla de 0,04 g es de la NCSE-02 y se aplica a edificios de
todas las épocas, aunque las normas anteriores zonificaban España de otra
forma.
:::

En toda España, el esquema da un 27 % de M3.1, un 7 % de M3.4, un 43 % de
RC1 (24 puntos anteriores a código y 19 de código bajo), un 11 % de RC3.1
y un 11 % de RC3.2. MERISUR, en cambio, clasificó los edificios de Lorca
mediante trabajo de campo y teledetección en seis clases de RISK-UE: una
de hormigón y cinco de mampostería. Afinar las clases de mampostería sigue
siendo la vía más clara para mejorar las estimaciones.

## 6. Daño

Un **modelo de daño** convierte el movimiento en un edificio en la
probabilidad de cada grado de daño. TWIN-ER ofrece dos, cada uno con sus
datos de vulnerabilidad, leídos a partir de la clase del edificio en la
taxonomía de esos datos (paso 5):

| Modelo de daño | Base de datos de vulnerabilidad | Clasificación | |
|---|---|---|---|
| Funciones de fragilidad | GEM (Martins y Silva 2021) | `gem_heuristic` | Por defecto |
| Espectro de capacidad | GEM (Martins y Silva 2021) | `gem_heuristic` | |
| Espectro de capacidad | RISK-UE (2003) | `risk_ue_feriche2012` | |

El modelo por defecto es el que más tiempo lleva en uso, no el que se ha
mostrado más preciso: ver [validación](#validación-lorca-2011). La página
de [Modelos de daño](/docs/es/hazards/earthquake/damage-models/) describe
cada método y base de datos en detalle.

Todos los modelos producen los mismos cuatro grados de daño, más "sin
daño". Las descripciones son orientativas:

| Grado | Daño estructural típico |
|---|---|
| Sin daño | Ninguno |
| Leve | Fisuras finas; reparable sin afectar al uso |
| Moderado | Fisuración apreciable; hay que reparar antes del uso normal |
| Extenso | Grietas grandes, fallo parcial de elementos; edificio probablemente inseguro |
| Completo | Colapso o colapso inminente; reparación no rentable |

### 6.1 Funciones de fragilidad

Una **función de fragilidad** da la probabilidad de que un edificio de una
clase alcance o supere un grado de daño, en función de una medida de
intensidad en su emplazamiento. TWIN-ER usa el modelo global de fragilidad
de **Martins y Silva (2021)** [11], de la misma familia que los modelos de
riesgo global y europeo de GEM. Se obtuvo analíticamente, mediante
análisis dinámico no lineal de edificios tipo de cada clase de la
taxonomía de GEM, y cada curva está definida respecto a la medida de
intensidad que mejor predice su daño (paso 2).

Las funciones siguen la forma lognormal habitual:

$$
P(DS \ge ds_i \mid IM) = \Phi\!\left( \frac{\ln(IM / \theta_i)}{\beta_i} \right)
$$

donde:

- $\theta_i$ es la intensidad mediana para el grado de daño $ds_i$;
- $\beta_i$ es su desviación típica logarítmica;
- $\Phi$ es la función de distribución normal estándar.

TWIN-ER usa las curvas publicadas en forma tabulada y las interpola en la
intensidad de cada edificio.

### 6.2 Espectro de capacidad

El **método del espectro de capacidad** es el nivel II (LM2) de RISK-UE
[16], el enfoque mecánico que describe la metodología de MERISUR. Parte de
la **curva de capacidad** de cada clase: la aceleración lateral $S_a$ que
resiste el edificio a medida que crece su desplazamiento $S_d$,
idealizada como bilineal, con un punto de plastificación $(D_y, A_y)$ y un
desplazamiento último $D_u$.

1. **Periodo elástico** del edificio: $T_e = 2\pi\sqrt{D_y / (A_y\,g)}$.
2. **Demanda:** la aceleración espectral del emplazamiento en ese periodo,
   $S_{ae} = SA(T_e)$, del mismo modelo de movimiento del suelo y la misma
   amplificación local que el resto de cálculos.
3. **Punto de desempeño:** el desplazamiento $S_d$ que el terremoto impone
   al edificio, en forma cerrada (método N2).
4. **Daño:** fragilidad lognormal sobre ese desplazamiento, con umbrales y
   dispersiones obtenidos de la propia curva de capacidad:

$$
P(DS \ge ds_k \mid S_d) = \Phi\!\left(\frac{\ln(S_d / S_{d,k})}{\beta_k}\right),
\qquad S_{d,k} = 0{,}7D_y,\ D_y,\ D_y + 0{,}25(D_u - D_y),\ D_u
$$

Las curvas de capacidad proceden de cualquiera de las dos bases de datos:
las de GEM, para las clases GEM, o las de RISK-UE, para las clases RISK-UE.
Ambas usan los umbrales de daño de RISK-UE, en los que el daño moderado
empieza en la plastificación.

### 6.3 De las probabilidades al grado mostrado

Sea cual sea el modelo, la probabilidad de estar en cada grado es la
diferencia entre curvas de excedencia consecutivas:

$$
P(DS = ds_i) = P(DS \ge ds_i) - P(DS \ge ds_{i+1})
$$

con $P(DS \ge \text{sin daño}) = 1$ y $P(DS \ge ds_5) = 0$.

El grado con el que se muestra cada edificio depende del nivel de
probabilidad (paso 4): el más probable o el percentil 85. La distribución
completa se conserva también:

- el mapa la muestra en la ventana de cada edificio;
- la lista de infraestructuras la indica para cada instalación;
- las cifras de secciones censales y municipios se calculan a partir de
  ella (paso 8).

## 7. Intensidad, infraestructuras y escombros

**Intensidad macrosísmica.** Protección civil en España trabaja con grados
de intensidad EMS-98 [12]. TWIN-ER convierte la velocidad máxima del suelo
del modelo (cm/s) en intensidad con Worden et al. (2012) [13], como hace
ShakeMap del USGS:

$$
I =
\begin{cases}
3{,}78 + 1{,}47 \log_{10}\text{PGV} & \log_{10}\text{PGV} < 0{,}53 \\
2{,}89 + 3{,}16 \log_{10}\text{PGV} & \log_{10}\text{PGV} \ge 0{,}53
\end{cases}
$$

La relación se ajustó para la intensidad de Mercalli modificada. MMI y
EMS-98 son en gran medida equivalentes en estos grados [14], así que se
presenta como EMS-98 (estimada). El mapa dibuja bandas de intensidad a
partir del grado IV, trazadas sobre una malla de al menos 1 km.

**Infraestructuras críticas.** Cada hospital, centro de salud, colegio,
universidad, residencia, comisaría o servicio de emergencias, central
eléctrica, subestación, puente y presa recibe la intensidad de su
ubicación. Proceden de la Base Topográfica Nacional del IGN. Un elemento se
considera afectado a partir de intensidad **VI**, "ligeramente dañino"
según la EMS-98. Una instalación aparece también por debajo de VI si el
edificio que ocupa resulta dañado.

**Envolventes de escombros.** Muchas de las muertes del terremoto de Lorca
de 2011 las causaron elementos de fachada caídos a la calle, no los
derrumbes. Siguiendo el simulador de MERISUR, cada edificio dañado muestra
a su alrededor una franja de espacio abierto que pueden alcanzar sus
escombros: 1, 2, 3 o 4 m para daño Leve, Moderado, Extenso o Completo. Las
franjas se precalculan para cada edificio y solo se extienden hacia el
espacio abierto, nunca sobre los edificios vecinos.

## 8. Impacto

Los grados de daño se convierten en las cifras que necesita la gestión de
emergencias: edificios y residentes afectados, población desplazada, coste
de reparación, toneladas de escombros, viajes de camión y puntales. Se
presentan por sección censal y municipio.

Estas cifras son **valores esperados**. Cada edificio cuenta en todos los
grados de daño en proporción a su probabilidad de estar en cada uno, y no
solo en el grado único que muestra el mapa. Un edificio con un 60 % de
probabilidad de daño Leve y un 40 % de Moderado suma 0,6 edificios a Leve y
0,4 a Moderado, y reparte del mismo modo sus viviendas y su superficie.

- **Por qué:** contar solo el grado más probable oculta el resto de la
  distribución. Con un movimiento moderado, muchos edificios tienen como
  grado más probable el Leve, pero una probabilidad apreciable de Moderado.
  En el conjunto de una ciudad, esas probabilidades se acumulan.
- **Mapa frente a cifras:** las cifras de una zona pueden diferir del
  número de edificios coloreados como dañados dentro de ella.
- **Detalle:** la página de
  [estimaciones de impacto](/docs/es/impact-estimates/) recoge cada fórmula
  y sus parámetros.

## Validación: Lorca 2011

El terremoto de Lorca del 11 de mayo de 2011 es el evento de referencia:

- **Evento.** Mw 5,2, muy superficial (pocos km de profundidad), en la
  falla de Alhama de Murcia.
- **Pérdidas.** Nueve fallecidos. La inspección posterior al terremoto
  cubrió 6.416 de los 7.890 edificios de la ciudad: 4.035 con daños leves
  (grados 1–2 de la EMS-98), 1.328 moderados (grados 2–3), 689 de
  moderados a graves (grados 3–4), y 329 tuvieron que ser demolidos
  (grados 4–5) [15]. Son 2.346 edificios con daño moderado o superior.
- **Movimiento registrado.** Unos 0,36 g de aceleración máxima cerca de la
  ciudad.

Al reproducirlo en modo manual con los datos nacionales:

- **Movimiento del suelo.** El movimiento mediano en Lorca es la mitad de
  la PGA registrada, aproximadamente. La mediana + 1σ (niveles "baja" y
  "muy baja") queda a pocos puntos porcentuales.
- **Intensidad.** La estimación para la ciudad es VI con la mediana y entre
  VI y VII con +1σ. El IGN observó VII.
**Daño.** La inspección cubrió la ciudad, no todo el municipio: Lorca es
uno de los municipios más extensos de España, y mayoritariamente rural.
Para comparar la misma zona, las cifras de TWIN-ER se toman en las
secciones censales de la ciudad (distrito 01 del INE, 7.001 edificios).
Son recuentos esperados, suma de probabilidades (ver
[estimaciones de impacto](/docs/es/impact-estimates/#datos-de-partida)),
para cada modelo de daño y nivel de probabilidad:

| Nivel | Modelo de daño | Leve | Moderado | Extenso | Completo | Algún daño | Moderado+ |
|---|---|--:|--:|--:|--:|--:|--:|
| | **Observado** (de 7.890) | 4.035 | 1.328 | 689 | 329 | 81 % | 30 % |
| Alta | Fragilidad (GEM) | 1.670 | 142 | 25 | 11 | 26 % | 3 % |
| | Espectro de capacidad (GEM) | 1.537 | 1.582 | 572 | 216 | 56 % | 34 % |
| | Espectro de capacidad (RISK-UE) | 787 | 1.600 | 806 | 409 | 51 % | 40 % |
| Baja, muy baja | Fragilidad (GEM) | 3.263 | 868 | 283 | 241 | 67 % | 20 % |
| | Espectro de capacidad (GEM) | 1.061 | 2.689 | 1.689 | 888 | 90 % | 75 % |
| | Espectro de capacidad (RISK-UE) | 1.013 | 1.849 | 1.649 | 1.130 | 81 % | 66 % |

Las categorías de la inspección son leve (grados 1–2 de la EMS-98),
moderado (2–3), de moderado a grave (3–4) y demolido (4–5); ocupan, en ese
orden, las columnas de Leve a Completo. Las probabilidades "baja" y "muy
baja" comparten el movimiento del suelo, así que dan los mismos recuentos
esperados.

Los niveles de probabilidad se diferencian en el grado con el que se
**muestra** cada edificio en el mapa. Contando esos grados (uno por
edificio) se obtiene:

| Nivel | Modelo de daño | Sin daño | Leve | Moderado | Extenso | Completo |
|---|---|--:|--:|--:|--:|--:|
| Alta | Fragilidad (GEM) | 6.549 | 452 | 0 | 0 | 0 |
| | Espectro de capacidad (GEM) | 3.668 | 1.222 | 2.111 | 0 | 0 |
| | Espectro de capacidad (RISK-UE) | 3.581 | 382 | 3.033 | 5 | 0 |
| Baja | Fragilidad (GEM) | 1.363 | 5.638 | 0 | 0 | 0 |
| | Espectro de capacidad (GEM) | 788 | 418 | 4.802 | 993 | 0 |
| | Espectro de capacidad (RISK-UE) | 1.497 | 918 | 2.441 | 1.865 | 280 |
| Muy baja | Fragilidad (GEM) | 569 | 2.739 | 3.043 | 650 | 0 |
| | Espectro de capacidad (GEM) | 109 | 47 | 977 | 2.805 | 3.063 |
| | Espectro de capacidad (RISK-UE) | 624 | 633 | 523 | 1.982 | 3.239 |

Lo que muestra la comparación:

- **Ningún modelo coincide en las dos medidas.** Con probabilidad "baja",
  cuyo movimiento del suelo coincide con el registrado, el modelo de
  fragilidad se queda algo corto respecto a lo observado (67 % de
  edificios dañados frente a 81 %, 20 % con daño moderado o superior
  frente a 30 %). Las dos variantes del espectro de capacidad lo superan:
  entre dos y tres veces la proporción observada con daño moderado o
  superior, aunque la proporción con algún daño de RISK-UE coincide con
  el 81 % observado.
- **Con probabilidad "alta", las variantes del espectro de capacidad son
  las que más se acercan a la proporción con daño moderado o superior**
  (34–40 % frente a 30 %), pero encuentran menos edificios dañados en
  total.
- **La mayor parte de la diferencia entre modelos procede de la definición
  de los grados de daño.** Los umbrales del espectro de capacidad hacen
  empezar el daño moderado en la plastificación, mientras que las
  funciones de fragilidad de GEM usan umbrales más suaves.
- **Los grados mostrados ocultan buena parte de la distribución.** Con
  probabilidad "baja", el modelo de fragilidad no muestra ningún edificio
  por encima de Leve, aunque su recuento esperado con daño moderado o
  superior ronda los 1.400.

La comparación es orientativa, no una calibración:

- **La ciudad se aproxima** por su distrito censal, que deja fuera parte de
  su periferia edificada.
- **Las categorías no se corresponden una a una.** Las categorías de la
  inspección proceden de las fichas de seguridad de los edificios y abarcan
  varios grados de la EMS-98 (moderado son los grados 2–3), así que no se
  corresponden exactamente con los grados de los modelos.

Es poco probable que la amplificación local sea una fuente de error
importante: la $V_{S30}$ del ESRM20 en Lorca coincide con los estudios
locales. La mayor incertidumbre está en la vulnerabilidad, en todos los
modelos: los datos de GEM son analíticos y globales, los de RISK-UE
proceden de edificios prototipo italianos y griegos, y ninguno está
calibrado con daños en España. El siguiente paso es calibrar con los
registros de daño de Lorca, edificio a edificio.

## Limitaciones

- **Solo escenarios deterministas.** No hay probabilidades anuales ni
  curvas de riesgo. Un escenario dice qué haría *este* terremoto, no lo
  probable que es.
- **Las rupturas de magnitud máxima rompen toda la falla modelada.** No se
  modelan rupturas por segmentos ni distribuciones magnitud-frecuencia.
- **Clases poco detalladas, asignadas por año y altura.** Tres clases GEM,
  o cinco tipologías RISK-UE con su nivel de código; el esquema RISK-UE
  está calibrado en Lorca. No hay información sobre sistema estructural,
  irregularidades, refuerzos ni estado de conservación.
- **Datos de vulnerabilidad genéricos.** Las funciones de fragilidad y
  curvas de capacidad de GEM son globales; las curvas de capacidad de
  RISK-UE proceden de prototipos italianos y griegos. Ninguno está
  calibrado con datos de daño en España.
- **Sin correlación espacial.** Todos los edificios se sitúan en el mismo
  punto de la distribución del movimiento (el $\varepsilon$ elegido), en
  lugar de muestrear campos correlacionados.
- **Solo se modela el daño estructural de los edificios.** No se modelan
  el daño no estructural, el contenido ni los efectos secundarios:
  deslizamientos, licuefacción e incendios.

## Referencias

1. Gaspar-Escribano, J. M., et al. (2017). Methodology for an effective
   risk assessment of urban areas: progress and first results of the
   MERISUR project. *16th World Conference on Earthquake Engineering*.
   [oa.upm.es/49862](https://oa.upm.es/49862/)
2. Pagani, M., Monelli, D., Weatherill, G., et al. (2014). OpenQuake
   Engine: an open hazard (and risk) software for the Global Earthquake
   Model. *Seismological Research Letters*, 85(3), 692–702.
   [doi:10.1785/0220130087](https://doi.org/10.1785/0220130087)
3. IGME. *QAFI v.4: Quaternary Active Faults Database of Iberia*. Instituto
   Geológico y Minero de España.
   [info.igme.es/qafi](https://info.igme.es/qafi/)
4. Wells, D. L., & Coppersmith, K. J. (1994). New empirical relationships
   among magnitude, rupture length, rupture width, rupture area, and
   surface displacement. *Bulletin of the Seismological Society of
   America*, 84(4), 974–1002.
5. Akkar, S., Sandıkkaya, M. A., & Bommer, J. J. (2014). Empirical
   ground-motion models for point- and extended-source crustal earthquake
   scenarios in Europe and the Middle East. *Bulletin of Earthquake
   Engineering*, 12(1), 359–387.
   [doi:10.1007/s10518-013-9461-4](https://doi.org/10.1007/s10518-013-9461-4)
6. Sandıkkaya, M. A., Akkar, S., & Bard, P.-Y. (2013). A nonlinear
   site-amplification model for the next pan-European ground-motion
   prediction equations. *Bulletin of the Seismological Society of
   America*, 103(1), 19–32.
   [doi:10.1785/0120120008](https://doi.org/10.1785/0120120008)
7. Crowley, H., Dabbeek, J., Despotaki, V., et al. (2021). *European
   Seismic Risk Model (ESRM20)*. EFEHR Technical Report 002.
   [doi:10.7414/EUC-EFEHR-TR002-ESRM20](https://doi.org/10.7414/EUC-EFEHR-TR002-ESRM20)
8. Weatherill, G., Crowley, H., Roullé, A., et al. (2023). Modelling site
   response at regional scale for the 2020 European Seismic Risk Model
   (ESRM20). *Bulletin of Earthquake Engineering*, 21, 665–714.
   [doi:10.1007/s10518-022-01526-5](https://doi.org/10.1007/s10518-022-01526-5)
9. Wald, D. J., & Allen, T. I. (2007). Topographic slope as a proxy for
   seismic site conditions and amplification. *Bulletin of the
   Seismological Society of America*, 97(5), 1379–1395.
   [doi:10.1785/0120060267](https://doi.org/10.1785/0120060267)
10. Brzev, S., Scawthorn, C., Charleson, A. W., et al. (2013). *GEM
    Building Taxonomy (Version 2.0)*. GEM Technical Report 2013-02.
    [doi:10.13117/GEM.EXP-MOD.TR2013.02](https://doi.org/10.13117/GEM.EXP-MOD.TR2013.02)
11. Martins, L., & Silva, V. (2021). Development of a fragility and
    vulnerability model for global seismic risk analyses. *Bulletin of
    Earthquake Engineering*, 19, 6719–6745.
    [doi:10.1007/s10518-020-00885-1](https://doi.org/10.1007/s10518-020-00885-1)
12. Grünthal, G. (ed.) (1998). *European Macroseismic Scale 1998
    (EMS-98)*. Cahiers du Centre Européen de Géodynamique et de
    Séismologie, 15.
13. Worden, C. B., Gerstenberger, M. C., Rhoades, D. A., & Wald, D. J.
    (2012). Probabilistic relationships between ground-motion parameters
    and Modified Mercalli intensity in California. *Bulletin of the
    Seismological Society of America*, 102(1), 204–221.
    [doi:10.1785/0120110156](https://doi.org/10.1785/0120110156)
14. Musson, R. M. W., Grünthal, G., & Stucchi, M. (2010). The comparison of
    macroseismic intensity scales. *Journal of Seismology*, 14, 413–428.
    [doi:10.1007/s10950-009-9172-0](https://doi.org/10.1007/s10950-009-9172-0)
15. Feriche, M., Vidal, F., Alguacil, G., Navarro, M., & Aranda, C. (2012).
    Vulnerabilidad y daño en el terremoto de Lorca de 2011. *Física de la
    Tierra*, 24, 255–287.
16. Milutinovic, Z. V., & Trendafiloski, G. S. (2003). *RISK-UE, WP4:
    Vulnerability of current buildings*. Informe del proyecto RISK-UE,
    EVK4-CT-2000-00014.
17. Real Decreto 997/2002, de 27 de septiembre, por el que se aprueba la
    norma de construcción sismorresistente: parte general y edificación
    (NCSE-02). *Boletín Oficial del Estado*, 244, 11 de octubre de 2002,
    anejo 1.
    [boe.es (PDF)](https://www.boe.es/boe/dias/2002/10/11/pdfs/A35898-35967.pdf)
