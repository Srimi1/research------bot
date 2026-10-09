# Literature review

Available in the 0.4.2 source on Android and desktop. ChatGPT sign-in and an available model are required; the browser preview can manage sources but cannot generate AI reviews.

1. Find candidate papers with **Evidence finder** or add links in **Source library**. Save the sources you want to consider.
2. Read the papers and record methods, findings, limitations and reading notes in the literature matrix. Click **Save notes** for each edited source. Papers need a supplied abstract or at least one saved evidence field with 12 meaningful characters; a title alone is insufficient.
3. Open **Assistants → Review**, or choose **Literature review** in the source library. Select between 1 and 12 papers. Selection belongs to the current project; a new session starts with no papers selected.
4. Optionally enter a focus or choose **Compare themes** or **Compare methods**, then click **Draft literature review**. Existing account access, session request limits and cancellation apply.
5. Read the draft and its limitations. Expand **Supporting evidence for this paragraph** to inspect quoted material. Follow a numbered citation to its reference and open the original source to check whether the synthesis is justified.
6. Choose **Add reviewed draft to notes** when you are satisfied. The app appends the draft, references and limitations without replacing existing notes. You can undo or redo the saved change and export the project as Markdown or JSON. **Copy draft** includes its references and limitations.

## What is shared

The request contains the project title, topic and research question, your review focus, and reference metadata and bounded evidence excerpts from the selected saved sources. Project notes and unselected sources are excluded. Abstracts and reading notes are limited to 2,000 characters each per source; methods, findings and limitations are limited to 800 characters each. The first five authors are supplied, with the total author count retained and “et al.” shown when appropriate. Large combined requests are refused before model inference; choose fewer sources or shorten the focus.

## Evidence and saved drafts

Every paragraph requires at least one citation to a selected source. The app verifies that each supporting quote appears in the supplied source field and that every selected source is cited. Invalid citations or omitted sources cause at most one format retry, within the session request budget. If the response still fails, your original notes remain unchanged.

These checks establish where the excerpt came from. They do not prove that the generated claim follows from it. Check the scientific interpretation yourself. The assistant does not fetch or read full papers, conduct a systematic search, establish novelty, or turn missing findings into evidence of absence. Researcher annotations remain researcher annotations, rather than verified extracted findings.

Each completed draft saves its reference and evidence snapshot in task history. Editing or removing a source does not erase the old draft. If the supplied material or reference metadata changed, generate a new review before adding it to notes. The full project JSON archive includes draft history; Markdown includes a review after you accept it into notes. No database migration or project reset is needed.
