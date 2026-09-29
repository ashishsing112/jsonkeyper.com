# model-mismatch

The thirteen payloads in `cases.json` run through Jackson 2, Jackson 3,
Pydantic 2 and Zod 4, for `blog/null-missing-unknown-fields.html`.

```sh
# Jackson (run from jackson2/ or jackson3/)
mvn -q dependency:build-classpath -Dmdep.outputFile=cp.txt
javac -cp "$(cat cp.txt)" -d out Check.java Hardened.java
java -cp "out:$(cat cp.txt)" Check          # defaults
java -cp "out:$(cat cp.txt)" Check strict   # FAIL_ON_*_CREATOR_PROPERTIES shortcut
java -cp "out:$(cat cp.txt)" Hardened       # the configuration the article recommends

# Pydantic (from this directory)
pip install pydantic==2.13.5 && python3 check_pydantic.py

# Zod (from zod/)
npm install && node check.mjs && node modifiers.mjs
```
