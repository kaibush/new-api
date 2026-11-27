/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { nameOptions } from '@/features/users/permission-groups/lib/policy'
import { ResourceRuleForm } from '@/features/users/permission-groups/rule-form'
import { useCatalogVisibility } from '@/features/users/permission-groups/use-catalog-visibility'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import { DescriptionDialog } from './dialogs/description-dialog'
import { MissingModelsDialog } from './dialogs/missing-models-dialog'
import { PrefillGroupManagement } from './dialogs/prefill-group-management'
import { PriceSyncDialog } from './dialogs/price-sync-dialog'
import { SyncWizardDialog } from './dialogs/sync-wizard-dialog'
import { VendorMutateDialog } from './dialogs/vendor-mutate-dialog'
import { ModelMutateDrawer } from './drawers/model-mutate-drawer'
import { useModels } from './models-provider'

export function ModelsDialogs() {
  const {
    open,
    setOpen,
    currentRow,
    permissionTargets,
    setPermissionTargets,
    currentVendor,
    descriptionData,
    setDescriptionData,
  } = useModels()
  const role = useAuthStore((state) => state.auth.user?.role)
  const isSuperAdmin = role === ROLE.SUPER_ADMIN
  const catalog = useCatalogVisibility({
    enabled: isSuperAdmin && open === 'permission-model',
  })

  return (
    <>
      <PriceSyncDialog
        open={open === 'price-sync'}
        onOpenChange={(value) => !value && setOpen(null)}
      />
      {/* Model Create/Update Drawer */}
      <ModelMutateDrawer
        open={
          open === 'create-model' ||
          open === 'update-model' ||
          open === 'price-model'
        }
        initialSection={open === 'price-model' ? 'pricing' : 'metadata'}
        onOpenChange={(v) => !v && setOpen(null)}
        currentRow={currentRow}
      />

      {open === 'permission-model' &&
        isSuperAdmin &&
        catalog.policy &&
        permissionTargets.length > 0 && (
          <ResourceRuleForm
            kind='models'
            names={permissionTargets}
            policy={catalog.policy}
            targets={nameOptions(permissionTargets)}
            pending={catalog.isSaving}
            onClose={() => {
              setOpen(null)
              setPermissionTargets([])
            }}
            onSave={(next) =>
              catalog.savePolicy(next, () => {
                setOpen(null)
                setPermissionTargets([])
              })
            }
          />
        )}

      {/* Vendor Create/Update Dialog */}
      <VendorMutateDialog
        key={`${open}-${currentVendor?.id ?? 'new'}`}
        open={open === 'create-vendor' || open === 'update-vendor'}
        onOpenChange={(v) => !v && setOpen(null)}
        currentVendor={open === 'update-vendor' ? currentVendor : null}
      />

      {/* Missing Models Dialog */}
      <MissingModelsDialog
        open={open === 'missing-models'}
        onOpenChange={(v) => !v && setOpen(null)}
      />

      {/* Sync Wizard Dialog */}
      <SyncWizardDialog
        open={open === 'sync-wizard'}
        onOpenChange={(v) => !v && setOpen(null)}
      />

      {/* Prefill Groups Management */}
      <PrefillGroupManagement
        open={open === 'prefill-groups'}
        onOpenChange={(v) => !v && setOpen(null)}
      />

      {/* Description Dialog */}
      <DescriptionDialog
        open={open === 'description'}
        onOpenChange={(v) => {
          if (!v) {
            setOpen(null)
            setDescriptionData(null)
          }
        }}
        modelName={descriptionData?.modelName || ''}
        description={descriptionData?.description || ''}
      />
    </>
  )
}
