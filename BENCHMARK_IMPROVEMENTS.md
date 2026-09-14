# CPX benchmark-response improvements

This release directly addresses the hands-on review that scored CPX 7.8/10. The benchmark below uses `npm run benchmark` with 100,000 lines and a 5.03 MiB synthetic JavaScript buffer. Timings naturally vary between runs, but the script is included so results are reproducible.

| Measurement | Review baseline | Improved CPX | Change |
| --- | ---: | ---: | ---: |
| Go to line 99,999 | 4.84 ms | 0.094 ms | about 52× faster |
| Vertical movement | 11.38 ms | 0.147 ms | about 77× faster |
| Literal search | 1.95 ms | 1.75 ms | about 10% faster |
| Mid-file insertion | 0.006 ms | 2.83 ms | incremental line-offset maintenance; still under 3 ms |
| First redraw after typing | about 98 ms in follow-up review | 7.49 ms | about 13× faster |
| Complete insertion + redraw path | about 98 ms | about 10.32 ms | about 9.5× faster |
| 120×40 steady redraw | 10.85 ms | 2.12 ms median | about 5.1× faster |
| Process RSS | 207 MiB | 98.4 MiB | about 52% lower |
| Automated tests | 30/31 | 41/41 | known regressions fixed and covered |

## What changed

- Cached line arrays and line-start offsets remove repeated full-buffer splitting during navigation. Binary search now maps offsets to lines.
- Ordinary single-line edits update the warm line cache in place, avoiding a full 5 MiB split on the next redraw.
- Diagnostics are debounced until 300 ms of idle time and computed in an unreferenced worker thread. Stale jobs are cancelled when typing resumes.
- Undo/redo tracks the saved content as a real savepoint, so undoing before and redoing back to a save reports the correct dirty state. Large-buffer history is bounded by an approximate 32 MB snapshot budget.
- `Ctrl+Y` and the `redo` command add real redo history.
- Theme-aware syntax highlighting covers Python, C/C++, JavaScript/TypeScript-style syntax, strings, numbers, and comments.
- Cached lightweight delimiter diagnostics appear in the footer; `F8` jumps through them.
- The Python hover precedence defect is fixed: a local assignment such as `name = "Ada"` now reports `name: str` instead of the generic `name` description.
- Untitled tabs no longer pass a null path into syntax detection; `Ctrl+N` has a regression test and was verified live.
- Run support now includes Python, C/C++, JavaScript, shell, Ruby, and Rust.
- Python import intelligence provides prebuilt member suggestions. After `import os`, `os.` offers `os.path`, `os.listdir`, `os.getcwd`, `os.environ`, and `os.makedirs`. Installed modules can be refreshed with `python-index MODULE` or `python-reindex`.
- `Ctrl+L` deletes highlighted text when present and otherwise deletes the current line.
- Ranked completion now displays up to five choices, combines case variants, includes general and language-specific vocabulary, and stores up to 5,000 words plus 2,000 phrases.

## Still intentionally out of scope

CPX now closes several benchmark gaps, but it does not claim to be a full IDE. A true language server, split panes, semantic project tree, and Git UI remain future work. The current diagnostics are deliberately lightweight and the filesystem navigator is not a permanently visible project sidebar.
