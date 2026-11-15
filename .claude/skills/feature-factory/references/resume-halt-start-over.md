# Resume, halt-commit and Start over rules

The feature-factory orchestrator reads this file in full when a stage in `../SKILL.md` says to, before any Halt and before a budget check on a resumed run. Stage and step numbers refer to `SKILL.md`, and Rules means its Rules section.

**Halt-commit rule** (Resume, and the Start over keep path):

- If HEAD's subject is exactly `chore: feature-factory halt commit` and the branch is not pushed (the Start over rule's test), run `git reset --soft HEAD~1`. Its work returns to the working tree and the stage's normal commit takes it, so no halt commit reaches the PR.
- Reset nothing in any other case; resume only ever undoes a HEAD commit with exactly that subject.
- If a commit with that subject is in `git log main..HEAD` but was not undone (not HEAD, or HEAD but pushed), warn "Halt commit <short hash> is still in the branch history" and carry on.

**Start over rule:**

- No commits beyond `main` (`git log main..HEAD` is empty): delete the run folder, keep the branch, begin at Stage 1.
- Commits exist: run `git fetch origin`. The branch counts as pushed when `git ls-remote --heads origin <branch>` lists it and `git rev-list main..origin/<branch>` is non-empty. If the fetch or ls-remote fails, treat it as pushed.
- Not pushed: ask every time, listing the commits the reset would discard (`git log --oneline main..HEAD`), with exactly two options.
  - **Keep the commits and run again**: apply the halt-commit rule, delete the run folder, run from Stage 1 on top of the commits.
  - **Reset the branch to main**: `git reset --hard main` (the tree is clean), delete the run folder, run from Stage 1.
- Pushed: do not offer the reset and ask no question. State "Commits are pushed; keeping them (no force push is ever used)." Then take the keep path.
- On every path, once the old folder is deleted and the new one exists, append all held answers as its first entries, in the order they were asked: the Resume or Start over answer, any preflight **proceed anyway**, the wrong-branch answer when it was asked, then the keep or reset answer when it was asked. Nothing from the deleted record carries over.
- **Mid-run Start over** (the Start over answer at a budget check on a resumed run; see Resume after a budget Halt in this file) replaces the previous bullet with this order:
  1. Hold in memory the old record's preflight **proceed anyway** entries and its wrong-branch answer.
  2. Run the halt commit (see Halt in this file). If it fails, stop with the folder intact and delete nothing.
  3. Apply the paths above, which delete the folder.
  4. Write the first entries of the new record: those **proceed anyway** entries in their old order, the wrong-branch entry, the Start over answer, then the keep or reset answer if it was asked. The old Resume answer is dropped.

**Halt**: a stop with these triggers only: the Outcome table rows whose destination is `Halt`. Read `outcome-table.md` in full before applying a Halt.

- A Halt keeps every file, applies the halt commit on the feature branch, and reports what failed and the branch name.
- **The halt commit.** If the tree has any change, stage it as Rules says and commit with the subject `chore: feature-factory halt commit`. A clean tree gets no commit. If the commit fails, report it and leave the tree as it is; the next run's preflight offers to retry it (Stage 0 step 3).
- **Resume after a budget Halt.** Counting reads `decisions.md` (Decisions record, `decisions-record.md`). When a resumed run reaches a budget check (Stage 4 respec, Stage 7 correction) and that budget was already spent at Resume and no unit has been granted since, do not Halt again and do not grant a unit yourself. Show what was spent, and ask via AskUserQuestion (see Rules), offering **Grant one more unit of the <respec|correction> budget** and **Start over**. A grant is recorded as its own entry and the run continues. **Start over** follows the mid-run Start over order in the Start over rule in this file. A budget spent during this invocation Halts as before. A resumed run never starts with fresh budgets. Known behaviour: a budget unit is recorded before the pass, so a session that dies before the pass commits is counted twice on Resume. This errs toward asking the owner for a grant, never toward extra passes.
- A halted run writes no notes and opens no PR.
- Rejected at stop 1 or 2, No at stop 3 and a Stage 8 blocker **Stop** are not Halts, but each applies the halt commit, and the files stay. A preflight stop applies none: past Stage 0 step 3 the tree is clean.

**Stops 1 and 2 on Resume:** read `decisions.md` and hold stop 1 again unless its latest entry is Approved or a recorded skip. Apply the same test to stop 2. A "Spent respec budget" entry after stop 2's latest Approved or recorded skip reopens stop 2, because the revised brief has not been approved. No entry means the stop is held. A stop with a recorded skip and no later respec spend is not held again.
