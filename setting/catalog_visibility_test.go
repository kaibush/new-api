package setting

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestCatalogAccountExclusions(t *testing.T) {
	previous := catalogVisibility.Load()
	t.Cleanup(func() { catalogVisibility.Store(previous) })
	require.NoError(t, UpdateCatalogVisibility(`{"audiences":{"staff":[11,22]},"models":{"members-only":["staff"],"hidden":[]},"groups":{},"model_exclusions":{"preview":[33,11,11],"members-only":[11]},"group_exclusions":{"internal":[33,11]}}`))
	for _, viewer := range []int{0, 11, 22, 33, 44} {
		allowed := viewer == 22 || viewer == 44
		require.Equal(t, allowed, CatalogModelAllowed(viewer, "preview@thinking:on"))
		require.Equal(t, allowed, CatalogGroupAllowed(viewer, "internal"))
		require.Equal(t, viewer == 22, CatalogModelAllowed(viewer, "members-only"))
		require.False(t, CatalogModelAllowed(viewer, "hidden"))
		require.True(t, CatalogModelAllowed(viewer, "public"))
	}
	for _, list := range []string{`null`, `{"preview":null}`, `{"preview":[]}`, `{"preview":[0]}`, `{"preview":[-2]}`, `{" preview":[1]}`, `{"preview":["1"]}`} {
		require.Error(t, UpdateCatalogVisibility(fmt.Sprintf(`{"audiences":{},"models":{},"groups":{},"model_exclusions":%s}`, list)))
		require.True(t, HasCatalogRestrictions())
		require.False(t, CatalogModelAllowed(22, "public"))
		require.False(t, CatalogGroupAllowed(22, "default"))
	}
}
