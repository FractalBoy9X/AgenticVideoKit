"""Python side of the library index (tools/lib/library.mjs).

    python tools/pymeta.py meta FILE.py…            → JSON: sound kinds of each sounds.py (name, about, tags, params)
    python tools/pymeta.py promote SRC.py KIND DEST.py → copy one cue kind (and the helpers it needs) into DEST

A sounds.py is read with `ast` only (nothing is executed). A kind is a public
top-level function; its description comes from META[kind], else from its docstring.
"""

from __future__ import annotations

import ast
import json
import re
import sys
from pathlib import Path


def _meta_dict(tree: ast.Module, name: str = "META") -> dict:
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == name for t in node.targets):
            try:
                return ast.literal_eval(node.value)
            except ValueError:
                return {}
    return {}


def meta(files: list[str]) -> dict:
    out = {}
    for f in files:
        src = Path(f).read_text()
        tree = ast.parse(src)
        m = _meta_dict(tree)
        kinds = []
        for node in tree.body:
            if isinstance(node, ast.FunctionDef) and not node.name.startswith("_"):
                d = m.get(node.name, {})
                doc = (ast.get_docstring(node) or "").split("\n")[0]
                kinds.append({"name": node.name, "about": d.get("about") or doc, "tags": d.get("tags", []), "params": d.get("params", {}), "documented": bool(d.get("about") and d.get("tags"))})
        out[f] = kinds
    return out


def _dict_node(tree: ast.Module, name: str):
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == name for t in node.targets) and isinstance(node.value, ast.Dict):
            return node.value
    return None


def _insert(text: str, name: str, key: str, value) -> str:
    """Add key: value inside the top-level dict literal `name = {…}` (so the index sees it)."""
    node = _dict_node(ast.parse(text), name)
    if node is None:
        return text.rstrip() + f"\n\n{name}[{key!r}] = {value!r}\n"
    lines = text.splitlines(keepends=True)
    off = sum(len(l) for l in lines[: node.end_lineno - 1]) + node.end_col_offset - 1  # the closing brace
    body = text[:off].rstrip()
    sep = "" if body.endswith(",") or body.endswith("{") else ","
    return body + f"{sep}\n    {key!r}: {value!r},\n" + text[off:]


def promote(src: str, kind: str, dest: str) -> dict:
    s_src, d_src = Path(src).read_text(), Path(dest).read_text()
    s_tree, d_tree = ast.parse(s_src), ast.parse(d_src)
    funcs = {n.name: n for n in s_tree.body if isinstance(n, ast.FunctionDef)}
    dfuncs = {n.name: n for n in d_tree.body if isinstance(n, ast.FunctionDef)}
    if kind not in funcs:
        raise SystemExit(f"{src}: no function {kind!r}")
    if kind in dfuncs:
        raise SystemExit(f"{dest}: {kind!r} already exists")
    s_lines, d_lines = s_src.splitlines(), d_src.splitlines()
    code = lambda lines, n: "\n".join(lines[(n.decorator_list[0].lineno if n.decorator_list else n.lineno) - 1: n.end_lineno])
    need, rename, todo = [], {}, [kind]
    while todo:  # the kind and the private helpers it calls; a helper DEST has in another version gets a new name
        name = todo.pop()
        if name in need:
            continue
        need.append(name)
        for node in ast.walk(funcs[name]):
            h = getattr(node, "id", None)
            if isinstance(node, ast.Name) and h in funcs and h.startswith("_") and h not in need:
                if h in dfuncs and code(d_lines, dfuncs[h]) == code(s_lines, funcs[h]):
                    continue  # identical helper already in DEST
                if h in dfuncs:
                    rename[h] = f"_{kind}{h}"
                todo.append(h)
    chunks = []
    for name in reversed(need):
        c = code(s_lines, funcs[name])
        for old, new in rename.items():
            c = re.sub(rf"\b{re.escape(old)}\b", new, c)
        chunks.append(c)
    text = d_src.rstrip() + "\n\n\n# ------------------------------------------------------------------ promoted from " + src + "\n" + "\n\n\n".join(chunks) + "\n"
    m = _meta_dict(s_tree).get(kind)
    if m:
        text = _insert(text, "META", kind, m)
    send = _meta_dict(s_tree, "SEND").get(kind)
    if send is not None:
        text = _insert(text, "SEND", kind, send)
    Path(dest).write_text(text)
    return {"copied": need, "renamed": rename, "meta": bool(m)}


def main() -> None:
    cmd, *args = sys.argv[1:]
    if cmd == "meta":
        print(json.dumps(meta(args), ensure_ascii=False))
    elif cmd == "promote":
        print(json.dumps(promote(*args)))
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main()
