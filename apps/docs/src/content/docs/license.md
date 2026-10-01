---
title: License and citation
description: TWIN-ER's licences for code, documentation and data, and how to cite it.
---

TWIN-ER is open source. Its parts are licensed as follows.

| Part | Licence |
|---|---|
| Source code: scenario API, pipelines, web app, infrastructure | [GNU Affero General Public License v3.0 or later](https://www.gnu.org/licenses/agpl-3.0.html) (AGPL-3.0-or-later) |
| This documentation: text, figures and diagrams | [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/) (CC BY 4.0) |
| Input datasets | Each publisher's own licence (see [Data sources](/docs/data-sources/)) |

The full texts are in the repository:
[`LICENSE`](https://github.com/arredond/twiner/blob/main/LICENSE) for the
code and
[`apps/docs/LICENSE`](https://github.com/arredond/twiner/blob/main/apps/docs/LICENSE)
for the documentation.

## Code: AGPL-3.0

You may use, study, modify and redistribute the code, including
commercially, under the AGPL's terms. In short:

- if you distribute TWIN-ER or a modified version, you must make the
  corresponding source available under the same licence;
- if you run a modified version as a **network service**, you must offer
  its source to that service's users. The web app does this through the
  "Source code" link in its settings menu.

The scenario engine builds on the OpenQuake `hazardlib` library (GEM
Foundation), which is itself licensed under the AGPL v3.

## Documentation: CC BY 4.0

You may share and adapt this documentation for any purpose, as long as you
give appropriate credit, link to the licence and indicate any changes.

## Data

Results are derived from the third-party datasets listed in
[Data sources](/docs/data-sources/), and remain subject to their licences
and attribution requirements. In particular:

- the QAFI fault database is licensed CC BY-SA 4.0, so data derived from it
  must be shared under the same terms;
- the OpenStreetMap basemap is licensed ODbL;
- the Martins & Silva (2021) fragility functions are published for free use
  with citation, without a formal licence.

## Citing TWIN-ER

If you use TWIN-ER or its results in research, please cite the project and
the models it builds on (see each hazard page's references):

> Arredondo, Á. (2026). *TWIN-ER: an open multi-hazard risk simulator for
> Spain*. https://twiner.arredon.do
