---
title: Fuentes de datos
description: Todos los conjuntos de datos que usa TWIN-ER, quién los publica y el recurso exacto del que se leen.
---

Todos los datos de entrada los publica un organismo público o un consorcio
de investigación. Cada entrada enlaza al recurso que TWIN-ER lee realmente:
un servicio de descarga, un servicio web o un fichero, no solo la página
principal del organismo. La mayoría se procesan una vez, offline, con los
pipelines de TWIN-ER. Las capas en tiempo real se consultan en directo.

Cuando se indica una licencia, es la que declara el organismo. En los demás
casos, los datos se publican con las condiciones de reutilización abierta
del propio organismo, que exigen citar la fuente.

## Edificios (exposición)

| Conjunto de datos | Organismo | Cobertura | Recurso |
|---|---|---|---|
| Edificios catastrales (INSPIRE Buildings) | Dirección General del Catastro | Toda España salvo el País Vasco y Navarra | [Servicio ATOM](https://www.catastro.hacienda.gob.es/INSPIRE/buildings/ES.SDGC.bu.atom.xml) |
| Edificios catastrales (INSPIRE) | Diputación Foral de Álava | Álava | [Servicio ATOM](https://geo.araba.eus/atom/BU/Buildings.atom) |
| Edificios catastrales | Diputación Foral de Gipuzkoa | Gipuzkoa | [Descarga ATOM](https://b5m.gipuzkoa.eus/inspire/download/buildings.xml) |
| Edificios catastrales (WFS) | Diputación Foral de Bizkaia | Bizkaia | [WFS](https://geo.bizkaia.eus/arcgisserverinspire/services/LurraldeAntolamendua_PlanificacionTerritorial/Katastro_Catastro_WFS/MapServer/WFSServer) |
| Edificios catastrales (WFS INSPIRE) | Gobierno de Navarra (IDENA) | Navarra | [WFS](https://inspire.navarra.es/services/BU/wfs) |

De cada edificio se toman la huella, las plantas, el año de construcción,
el uso, las viviendas y la superficie construida. El País Vasco y Navarra
tienen sus propios catastros forales, así que sus datos proceden de cuatro
servicios distintos.

## Límites y población

| Conjunto de datos | Organismo | Cobertura | Licencia | Recurso |
|---|---|---|---|---|
| Líneas límite municipales | Instituto Geográfico Nacional (IGN/CNIG) | Toda España: municipios, provincias y comunidades autónomas | CC BY 4.0 | [Servicio ATOM](https://www.ign.es/atom/dataset_feeds/lin_lim_mun.es.xml) |
| Seccionado censal, 1 de enero de 2025 | Instituto Nacional de Estadística (INE) | Toda España, 36.554 secciones | | [Descarga](https://www.ine.es/prodyser/cartografia/seccionado_2025.zip) |
| *Censo Anual de Población*: población por sexo y grupo quinquenal de edad, por sección censal | INE | Toda España, una tabla por provincia | | [Índice de resultados](https://www.ine.es/dynt3/inebase/es/index.htm?padre=11555&capsel=11154) |

## Terremotos

| Conjunto de datos | Organismo | Cobertura | Licencia | Recurso |
|---|---|---|---|---|
| QAFI v4: base de datos de fallas activas del Cuaternario de Iberia | Instituto Geológico y Minero de España (IGME-CSIC) | 201 fallas activas en España | CC BY-SA 4.0 | [Trazas de fallas](https://info.igme.es/qafi/docs/QAFI_Traces.rar) |
| Modelo de suelo del ESRM20 ($V_{S30}$, 30 segundos de arco) | EFEHR / ETH Zúrich, Modelo Europeo de Riesgo Sísmico 2020 | España, salvo Canarias | CC BY 4.0 | [Repositorio](https://gitlab.seismo.ethz.ch/efehr/esrm20) |
| Funciones de fragilidad globales (Martins y Silva 2021) | Autores de la Fundación GEM | 3 clases de edificio, de 1 a 12 plantas | CC BY-SA 4.0 | [Repositorio](https://github.com/lmartins88/global_fragility_vulnerability) |
| Curvas de capacidad de RISK-UE (tablas 3.1-1 y 3.1-2 del WP4) | Proyecto RISK-UE (contrato de la UE EVK4-CT-2000-00014): UNIGE, AUTh | 6 tipologías, sin normativa y normativa baja, 3 rangos de altura | © Comisión Europea, 2003; parámetros citados por tabla | Milutinovic y Trendafiloski (2003), informe del WP4 |
| Anejo 1 de la NCSE-02: aceleración sísmica básica $a_b$ y coeficiente $K$ por municipio | Ministerio de Fomento, Real Decreto 997/2002 (BOE núm. 244, 11 de octubre de 2002) | 2.615 municipios con $a_b \ge 0{,}04$ g, emparejados con 2.613 actuales | Texto legal, excluido de la propiedad intelectual (art. 13 de la LPI) | [BOE (PDF)](https://www.boe.es/boe/dias/2002/10/11/pdfs/A35898-35967.pdf) |

El modelo de movimiento del suelo, Akkar et al. (2014), procede de la
biblioteca `hazardlib` de OpenQuake (Fundación GEM, AGPL-3.0).

## Inundaciones

| Conjunto de datos | Organismo | Cobertura | Recurso |
|---|---|---|---|
| Zonas inundables asociadas a periodos de retorno, segundo ciclo | Ministerio para la Transición Ecológica (MITECO), SNCZI | Tramos de río estudiados. Península y Baleares para T = 10, 50, 100 y 500 años; Canarias para T = 100 y 500 | [Página de descarga](https://www.miteco.gob.es/es/cartografia-y-sig/ide/descargas/agua/zi-lamina.html) |

## Infraestructuras críticas

| Conjunto de datos | Organismo | Cobertura | Licencia | Recurso |
|---|---|---|---|---|
| Base Topográfica Nacional (BTN): temas de servicios e instalaciones, energía y construcciones | IGN/CNIG | Toda España | CC BY 4.0 | [Página de descarga](https://centrodedescargas.cnig.es/CentroDescargas/btn) |

De la BTN, TWIN-ER toma:

- colegios y universidades;
- hospitales y centros de salud;
- residencias;
- policía y servicios de emergencia;
- centrales eléctricas y subestaciones;
- puentes;
- presas, solo las incluidas en el inventario de presas del MITECO. La BTN
  también recoge como presas balsas y muros de regadío.

Los hospitales, colegios y presas incluyen su identificador en el registro
nacional correspondiente.

## Capas en tiempo real

La API las consulta en directo cuando el mapa las pide; no se almacenan.

| Conjunto de datos | Organismo | Cobertura | Recurso |
|---|---|---|---|
| Incidencias de tráfico (DATEX II v3.7) | Dirección General de Tráfico (DGT), Punto de Acceso Nacional | España salvo el País Vasco y la mayor parte de Cataluña | [Feed](https://nap.dgt.es/datex2/v3/dgt/SituationPublication/datex2_v37.xml) |
| Incidencias de tráfico (DATEX II) | Servei Català de Trànsit (SCT) | Cataluña | [Feed](https://nap.dgt.es/datex2/sct/SituationPublication/all/content.xml) |
| Incidencias de tráfico (DATEX II) | Dirección de Tráfico del Gobierno Vasco (Trafikoa) | País Vasco | [Feed](https://nap.dgt.es/datex2/dt-gv/SituationPublication/all/content.xml) |
| Observación convencional | Agencia Estatal de Meteorología (AEMET), OpenData | Unas 850 estaciones automáticas, últimas 24 horas | [API](https://opendata.aemet.es/centrodedescargas/inicio) (clave gratuita) |
| Avisos meteorológicos Meteoalerta (CAP 1.2) | AEMET, OpenData | Toda España, por zona de aviso, hasta pasado mañana | [API](https://opendata.aemet.es/centrodedescargas/inicio) (clave gratuita) |

Algunas incidencias regionales solo indican la carretera y el punto
kilométrico, sin coordenadas. Todavía no se muestran.

## Mapa base

| Conjunto de datos | Organismo | Licencia | Recurso |
|---|---|---|---|
| Teselas vectoriales de OpenStreetMap (compilación diaria), recorte que cubre España | Protomaps; datos © colaboradores de OpenStreetMap | ODbL | [Compilaciones](https://maps.protomaps.com/builds/) |
| Fuentes y sprites del mapa base | Protomaps (fuentes Noto Sans) | OFL | [basemaps-assets](https://github.com/protomaps/basemaps-assets) |

El mapa base se aloja en el propio proyecto como un único fichero PMTiles,
así que la aplicación no depende de ningún servicio de mapas de terceros.
