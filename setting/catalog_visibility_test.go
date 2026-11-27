package setting

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCatalogAccountExclusions(t *testing.T) {
	previous := catalogVisibility.Load()
	t.Cleanup(func() { catalogVisibility.Store(previous) })
	require.NoError(t, UpdateCatalogVisibility(`{"audiences":{"staff":[11,22]},"models":{"members-only":["staff"],"hidden":[]},"groups":{},"model_exclusions":{"preview":[33,11,11],"members-only":[11]},"group_exclusions":{"internal":[33,11]}}`))
	for _, viewer := range []int{0, 11, 22, 33, 44} {
		allowed := viewer == 22 || viewer == 44
		require.Equal(t, allowed, CatalogModelAllowed(viewer, "preview@thinking:on"))
		require.Equal(t, allowed, CatalogModelGranted(viewer, "preview@thinking:on"))
		require.Equal(t, allowed, CatalogGroupAllowed(viewer, "internal"))
		require.Equal(t, allowed, CatalogGroupGranted(viewer, "internal"))
		require.Equal(t, viewer == 22, CatalogModelAllowed(viewer, "members-only"))
		require.Equal(t, viewer == 22, CatalogModelGranted(viewer, "members-only"))
		require.False(t, CatalogModelAllowed(viewer, "hidden"))
		require.False(t, CatalogModelGranted(viewer, "hidden"))
		require.True(t, CatalogModelAllowed(viewer, "public"))
		require.False(t, CatalogModelGranted(viewer, "public"))
	}
	for _, list := range []string{`null`, `{"preview":null}`, `{"preview":[]}`, `{"preview":[0]}`, `{"preview":[-2]}`, `{" preview":[1]}`, `{"preview":["1"]}`} {
		require.Error(t, UpdateCatalogVisibility(fmt.Sprintf(`{"audiences":{},"models":{},"groups":{},"model_exclusions":%s}`, list)))
		require.True(t, HasCatalogRestrictions())
		require.False(t, CatalogModelAllowed(22, "public"))
		require.False(t, CatalogGroupAllowed(22, "default"))
	}
}

func TestCatalogOpenRulesDirectUsersAndExcludedGroups(t *testing.T) {
	previous := catalogVisibility.Load()
	t.Cleanup(func() { catalogVisibility.Store(previous) })

	raw := `{
		"audiences": {"vip": [20, 30], "blocked_team": [30, 40]},
		"models": {"vip-model": ["vip"]},
		"groups": {},
		"model_users": {"vip-model": [50], "direct-only": [60]},
		"group_users": {"vip-route": [60]},
		"open_models": ["open-for-users"],
		"open_groups": ["open-route"],
		"model_exclusions": {"open-for-users": [70]},
		"model_excluded_groups": {"open-for-users": ["blocked_team"], "vip-model": ["blocked_team"]},
		"group_excluded_groups": {"open-route": ["blocked_team"]}
	}`
	require.NoError(t, UpdateCatalogVisibility(raw))
	require.True(t, HasCatalogRestrictions())

	// Guest (0) cannot access open, allowlisted, or direct-user models/groups, but unconfigured remains default.
	assert.False(t, CatalogModelAllowed(0, "open-for-users"))
	assert.False(t, CatalogModelGranted(0, "open-for-users"))
	assert.False(t, CatalogGroupAllowed(0, "open-route"))
	assert.Empty(t, CatalogPermittedGroups(0))
	assert.True(t, CatalogModelAllowed(0, "unconfigured-model"))

	// Regular logged-in user (99) gets open-for-users & open-route, not allowlisted ones.
	assert.True(t, CatalogModelAllowed(99, "open-for-users@thinking:high"))
	assert.True(t, CatalogModelGranted(99, "open-for-users@thinking:high"))
	assert.False(t, CatalogModelAllowed(99, "vip-model"))
	assert.False(t, CatalogModelAllowed(99, "direct-only"))
	assert.Equal(t, []string{"open-route"}, CatalogPermittedGroups(99))

	// Excluded group member (30 is in both vip and blocked_team -> Deny > Allow).
	assert.False(t, CatalogModelAllowed(30, "vip-model"))
	assert.False(t, CatalogModelGranted(30, "vip-model"))
	assert.False(t, CatalogModelAllowed(30, "open-for-users"))
	assert.Empty(t, CatalogPermittedGroups(30))

	// Excluded direct account (70).
	assert.False(t, CatalogModelAllowed(70, "open-for-users"))

	// VIP member not in blocked_team (20) and direct user (50, 60).
	assert.True(t, CatalogModelAllowed(20, "vip-model"))
	assert.True(t, CatalogModelGranted(20, "vip-model"))
	assert.True(t, CatalogModelAllowed(50, "vip-model"))
	assert.True(t, CatalogModelGranted(50, "vip-model"))
	assert.True(t, CatalogModelAllowed(60, "direct-only"))
	assert.Equal(t, []string{"open-route", "vip-route"}, CatalogPermittedGroups(60))

	for _, invalid := range []string{
		`{"audiences":{},"models":{},"groups":{},"unknown_field":{}}`,
		`{"audiences":{},"models":{},"groups":{},"open_models":[""]}`,
		`{"audiences":{},"models":{},"groups":{},"model_users":{"m":[]}}`,
		`{"audiences":{},"models":{},"groups":{},"model_excluded_groups":{"m":["missing"]}}`,
	} {
		_, err := ParseCatalogVisibility(invalid)
		require.Error(t, err)
	}
}
