# Table Fixture

## Plain

| Name  | Score |
| ----- | ----- |
| Alice | 90    |
| Bob   | 85    |

## Alignment

| left | center | right | default |
| :--- | :----: | ----: | ------- |
| a    |   b    |     c | d       |

## Inline content in cells

| Syntax   | Example                  |
| -------- | ------------------------ |
| bold     | **strong**               |
| emphasis | _slanted_                |
| code     | `inline()`               |
| link     | [numenumd](https://x.jp) |
| math     | $x_{i}$                  |
| image    | ![alt](p.png)            |
| pipe     | a \| b                   |
| dash     | - not a list             |

## Ragged rows (padded, nothing is lost)

| a   | b   |
| --- | --- |
| 1   |     |
| 2   | 3   |

## In a blockquote

> | q   | r   |
> | --- | --- |
> | 1   | 2   |

## In a list item

- an item

  | s   | t   |
  | --- | --- |
  | 1   | 2   |

## Excess cells stay a raw block

The third cell on the last row would be dropped by GFM, so this table is kept verbatim instead of being converted into an editable table.

| a   | b   |
| --- | --- |
| 1   | 2   | 3   |

## Code span containing a pipe stays a raw block

markdown-it splits cells before inline parsing, so the pipe inside the code span counts as a cell boundary and produces an excess cell.

| a   | b   |
| --- | --- |
| x   | `p  | q`  |

## Raw HTML table

<table>
  <tr><td rowspan="2">merged</td><td>x</td></tr>
  <tr><td>y</td></tr>
</table>
