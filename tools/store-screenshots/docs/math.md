# 波動方程式のノート

弦を伝わる波の速さは張力 $T$ と線密度 $\mu$ から $v = \sqrt{T/\mu}$ と書けます。
変位 $u(x,t)$ が従う支配方程式は次の通りです。

$$
\frac{\partial^2 u}{\partial t^2} = c^2 \frac{\partial^2 u}{\partial x^2}
$$

境界条件 $u(0,t) = u(L,t) = 0$ のもとで変数分離すると、固有振動は

$$
u_n(x,t) = A_n \sin\left(\frac{n\pi x}{L}\right)\cos(\omega_n t + \phi_n)
$$

となり、角振動数は $\omega_n = n\pi c / L$ で決まります。

## メモ

- インライン数式もブロック数式も KaTeX でそのまま描画されます
- 描画された数式をクリックすると、その場で LaTeX の編集に戻れます
- 地の文に出てくる通貨記号は、数式として扱われません
