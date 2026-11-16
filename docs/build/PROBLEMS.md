# Problem set

The 18 eval problems. The netlists and expected answers here are the source of truth. Copy them exactly. Every expected answer was checked numerically when this file was written.

All component values are in SI base units. `gnd` is the ground node in every circuit. Node names A, B, C are printed in the image.

## Circuits answered by one solve

| Id | Components (`id type value a b`) | Question | Expected claim |
|---|---|---|---|
| `c01` | `V1 V 12 A gnd`, `R1 R 1000 A B`, `R2 R 2000 B gnd` | What is the voltage at node B? | `node_voltage` node B, value **8** |
| `c02` | `V1 V 9 A gnd`, `R1 R 100 A B`, `R2 R 220 B C`, `R3 R 130 C gnd` | What current flows through R2, from node B to node C? | `branch_current` R2, value **0.02** |
| `c03` | `V1 V 10 A gnd`, `R1 R 50 A B`, `R2 R 100 B gnd`, `R3 R 100 B gnd` | How much power does R2 dissipate? | `power` R2 absorbed, value **0.25** |
| `c04` | `I1 I 0.002 A gnd`, `R1 R 1000 A gnd`, `R2 R 3000 A gnd` | What is the voltage at node A? | `node_voltage` node A, value **1.5** |
| `c05` | `V1 V 16 A gnd`, `R1 R 1000 A B`, `R2 R 2000 B gnd`, `R3 R 1000 B C`, `R4 R 1000 C gnd` | What is the voltage at node C? | `node_voltage` node C, value **4** |
| `c06` | `V1 V 10 A gnd`, `R1 R 1000 A B`, `R2 R 2000 B gnd`, `R3 R 2000 A C`, `R4 R 1000 C gnd`, `R5 R 1000 B C` | What current flows through R5, from node B to node C? | `branch_current` R5, value **0.00142857** (1/700) |
| `c07` | `V1 V 12 A gnd`, `R1 R 2000 A B`, `R2 R 2000 B gnd`, `I1 I 0.003 B gnd` | What is the voltage at node B? | `node_voltage` node B, value **9** |
| `c08` | `V1 V 10 A gnd`, `R1 R 1000 A B`, `R3 R 1000 B gnd`, `R2 R 1000 B C`, `V2 V 4 C gnd` | How much power does V1 deliver? | `power` V1 delivered, value **0.0533333** (4/75) |

`V` is `voltage_source` (`a` is +), `I` is `current_source` (current enters `a`), `R` is `resistor`. Every setup is empty (`remove: []`, `zero: []`).

## Circuits that need more than one solve

| Id | Components | Question | Expected claim |
|---|---|---|---|
| `c09` | `V1 V 12 A gnd`, `R1 R 4000 A B`, `R2 R 12000 B gnd`, `R3 R 1000 B C`, `RL R 2000 C gnd` | What is the Thevenin equivalent that RL sees? | `thevenin` a C, b gnd, remove [RL], vth **9**, rth **4000** |
| `c10` | `V1 V 20 A gnd`, `R1 R 6000 A B`, `R2 R 3000 B gnd`, `RL R 1000 B gnd` | RL is adjustable. What value of RL receives the most power, and how much power is that? | `max_power_transfer` load RL, resistance **2000**, power **0.00555556** (1/180) |
| `c11` | `V1 V 15 A gnd`, `R1 R 10000 A B`, `R2 R 10000 B gnd`, `R3 R 30000 B gnd` | R2 is adjustable. What value of R2 makes the voltage at node B equal 9 V? | `component_value_for_condition` R2, condition node_voltage B = 9, value **30000** |
| `c12` | `V1 V 18 A gnd`, `R1 R 3000 A B`, `R2 R 6000 B gnd`, `I1 I 0.002 B gnd` | How much of the voltage at node B is due to the current source I1 alone? | `node_voltage` node B, setup zero [V1], value **4** |
| `c13` | `V1 V 8 A gnd`, `R1 R 1000 A B`, `R2 R 6000 B gnd`, `R3 R 2000 B C`, `R4 R 4000 C gnd` | What equivalent resistance does the source V1 see? | `equivalent_resistance` a A, b gnd, remove [V1], value **4000** |
| `c14` | `V1 V 24 A gnd`, `R1 R 2000 A B`, `R2 R 4000 B gnd`, `R3 R 1000 B gnd` | R3 is adjustable. What value of R3 makes the current through R1 equal 9 mA? | `component_value_for_condition` R3, condition branch_current R1 = 0.009, value **800** |

Extra reference values, for tests: in `c12` the voltage at B is 12 V from V1 alone and 16 V in total. In `c10`, RL at 2000 Ω absorbs 0.00555556 W.

## Closed-form formulas

Each problem file carries its formula as a comment. These are the derivations.

| Id | Formula |
|---|---|
| `c01` | `12 × 2000 / (1000 + 2000)` |
| `c02` | `9 / (100 + 220 + 130)` |
| `c03` | `V_B = 10 × 50 / (50 + 50)` with `R2 ∥ R3 = 50`; `P = V_B² / 100` |
| `c04` | `0.002 × (1000 × 3000) / (1000 + 3000)` |
| `c05` | `R_B = 2000 ∥ (1000 + 1000) = 1000`; `V_B = 16 × 1000 / 2000 = 8`; `V_C = V_B / 2` |
| `c06` | Nodal: `5 V_B − 2 V_C = 20`, `5 V_C − 2 V_B = 10`; `V_B = 40/7`, `V_C = 30/7`; `I = (V_B − V_C) / 1000` |
| `c07` | Nodal at B: `(V_B − 12)/2000 + V_B/2000 = 0.003` |
| `c08` | Nodal at B: `(V_B − 10) + V_B + (V_B − 4) = 0`, `V_B = 14/3`; `P = 10 × (10 − V_B) / 1000` |
| `c09` | `vth = 12 × 12000 / 16000`; `rth = 1000 + (4000 ∥ 12000)` |
| `c10` | `vth = 20 × 3000 / 9000`; `rth = 6000 ∥ 3000`; `P = vth² / (4 × rth)` |
| `c11` | `R_B / (10000 + R_B) = 9/15` gives `R_B = 15000`; `R2 ∥ 30000 = 15000` gives `R2 = 30000` |
| `c12` | With V1 shorted: `0.002 × (3000 ∥ 6000)` |
| `c13` | `1000 + (6000 ∥ (2000 + 4000))` |
| `c14` | `V_B = 24 − 0.009 × 2000 = 6`; `I_R3 = 0.009 − 6/4000 = 0.0075`; `R3 = 6 / 0.0075` |

## Drawing each circuit

Every circuit uses one of three layouts. The builder picks grid coordinates that follow the layout, then looks at the rendered PNG to confirm it.

**Loop** (`c02`): the source stands vertically on the left. The resistors lie in a row along the top wire. The bottom wire returns to the source.

```
A ──R1── B ──R2── C
│                 │
V1                R3
│                 │
gnd ──────────────┘
```

**Ladder** (`c01`, `c03`, `c04`, `c05`, `c07`, `c08`, `c09`, `c10`, `c11`, `c12`, `c13`, `c14`): the first source stands vertically on the left. Series components lie along the top wire. Every component that connects to `gnd` stands vertically between the top wire and the bottom wire.

```
A ──R1── B ──R3── C
│        │        │
V1       R2       R4
│        │        │
gnd ─────┴────────┘
```

**Bridge** (`c06`): the source on the left, then two vertical dividers side by side, with R5 lying horizontally between their midpoints.

```
A ─────┬───────────┐
│      R1          R3
V1     B ────R5─── C
│      R2          R4
gnd ───┴───────────┘
```

Rules for every drawing:

1. Wires are horizontal or vertical. No wire crosses another wire or a component.
2. Every point where three or more wire ends meet has a dot.
3. The image shows a ground symbol on the bottom wire.
4. The image prints every node name the question or the expected claim uses, and every component's id and label.
5. A voltage source shows + at terminal `a`. A current source's arrow points at terminal `a`.

## Styles and label formats

Vary these so the reader is not tested on one drawing style.

| Id | Resistor symbol | Label format | Example |
|---|---|---|---|
| `c01`, `c07`, `c11` | zigzag | value, space, prefixed unit | `1 kΩ`, `12 V`, `3 mA` |
| `c02`, `c03` | box | plain ohms | `220 Ω` |
| `c04`, `c12` | zigzag | no space, no ohm sign for resistors | `1k`, `2mA` |
| `c05`, `c13` | box | RKM code for resistors | `1k0`, `6k0` |
| `c06`, `c08`, `c14` | zigzag | value, space, prefixed unit | `2 kΩ` |
| `c09`, `c10` | box | value, space, prefixed unit | `4 kΩ` |

In `c10`, `c11` and `c14`, the adjustable resistor's label is its nominal value from the table (`1 kΩ`, `10 kΩ`, `1 kΩ`).

## Graphs

All series are piecewise-linear or bars through whole-number points, so the expected answers are exact.

| Id | Axes | Series | Question | Expected claim |
|---|---|---|---|---|
| `g01` | x: time (s), 0 to 10. y: position (m), 0 to 20. | line `s1`: (0,0), (2,4), (5,10), (8,10), (10,16) | What is the position at t = 4 s? | `graph_value` s1, x 4, value **8** |
| `g02` | x: time (s), 0 to 12. y: velocity (m/s), 0 to 16. | line `s1`: (0,2), (4,14), (8,14), (12,6) | What is the acceleration between t = 8 s and t = 12 s? | `graph_slope` s1, x1 8, x2 12, value **−2** |
| `g03` | x: time (s), 0 to 8. y: velocity (m/s), 0 to 8. | line `s1`: (0,0), (2,6), (6,6), (8,0) | How far does the object travel between t = 0 s and t = 8 s? | `graph_area` s1, x1 0, x2 8, value **36** |
| `g04` | x: month, 1 to 6. y: sales (units), 0 to 35. | bar `s1`: (1,12), (2,18), (3,25), (4,31), (5,22), (6,15) | Which month has the highest sales, and how many units? | `graph_extremum` s1, max, x **4**, value **31** |

## Replay samples

Two circuits double as the replay samples. Each fixture holds a recorded reading with one deliberate misread.

| Sample | Misread in the fixture | How the user finds it |
|---|---|---|
| `c01` | `R2` has `label: "2 kΩ"` and `value: 20000` | The validator shows a `label_mismatch` warning on R2. |
| `c09` | `R2` has `label: "1.2 kΩ"` and `value: 1200` (the image says 12 kΩ) | No warning. The user compares the table with the image. |
