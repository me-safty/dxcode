import type { T3workSidecarRecipeQuickStart } from "~/t3work/t3work-sidecarRecipes";

export function T3workKickoffRecipeList({
  recipes,
  onSelectRecipe,
}: {
  recipes: ReadonlyArray<T3workSidecarRecipeQuickStart>;
  onSelectRecipe: (recipe: T3workSidecarRecipeQuickStart) => void;
}) {
  return (
    <div className="space-y-2.5">
      {recipes.map((recipe) => (
        <button
          key={recipe.id}
          type="button"
          className="w-full rounded-md border border-border/70 bg-transparent px-3 py-2.5 text-left transition-colors hover:border-border hover:bg-accent/30"
          onClick={() => onSelectRecipe(recipe)}
        >
          <div className="text-sm font-medium text-foreground/90">{recipe.title}</div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground/80">{recipe.description}</p>
        </button>
      ))}
    </div>
  );
}
