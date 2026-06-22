# Dinner Spinner

Personal recipe app: spin for a random dish, scale servings, build a shopping
list. This glossary captures terms whose meaning isn't obvious from the code —
especially where one everyday word is overloaded.

## Language

**Dish**:
One saved recipe — its title, ingredients, method, image and metadata. When a
user says "recipe" in conversation they almost always mean a Dish.
_Avoid_: Recipe (ambiguous — see Method)

**Method**:
The cooking instructions of a Dish: ordered steps, optionally grouped under
section headers. Stored in the `dishes.recipe` column, whose name predates this
distinction — the column holds the method, not the whole dish.
_Avoid_: Instructions, directions

**Ingredient reference**:
An inline marker in the Method text that binds a phrase ("the eggs", "the
dough") to the ingredient(s) it names, so the UI can highlight it and link it to
the ingredient list. It lives inside the Method text itself — there is no
separate store.
_Avoid_: Method ref, phrase ref

**Ingredient id**:
A stable identifier carried by each ingredient, durable across reordering,
insertion and deletion. An Ingredient reference points at this id, never at a
list position.
_Avoid_: Index, position
