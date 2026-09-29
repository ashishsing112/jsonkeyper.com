"""Validate each case in cases.json against a Pydantic v2 model, in the default
(lax) mode and with strict=True plus extra='forbid'.

    python3 -m venv .venv && .venv/bin/pip install pydantic==2.13.5
    .venv/bin/python check_pydantic.py
"""
import json
import pydantic
from pydantic import BaseModel, ConfigDict, ValidationError


class Order(BaseModel):
    id: int
    name: str
    note: str | None = None
    tags: list[str]


class StrictOrder(Order):
    model_config = ConfigDict(strict=True, extra='forbid')


cases = json.load(open('cases.json'))
for label, model in (('default', Order), ('strict', StrictOrder)):
    print('== pydantic', pydantic.VERSION, label)
    for name, data in cases:
        try:
            print(name, '\tOK', model.model_validate(data).model_dump())
        except ValidationError as e:
            print(name, '\tERROR', '; '.join(err['type'] for err in e.errors()))
