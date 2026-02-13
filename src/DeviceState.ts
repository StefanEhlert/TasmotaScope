/**
 * Frontend-DeviceState: nutzt das gemeinsame Shared-Modul (Node- und Browser-kompatibel).
 * Re-exportiert RuleConfig und stellt die gleiche API wie zuvor bereit.
 */

import { createDeviceStore, type RuleConfig as SharedRuleConfig } from 'tasmotascope-shared'

export type RuleConfig = SharedRuleConfig

const store = createDeviceStore()

export const DeviceState = {
  subscribe: store.subscribe.bind(store),
  getSnapshot: store.getSnapshot.bind(store),
  getRaw: store.getRaw.bind(store),
  getRules: store.getRules.bind(store),
  getProperties: store.getProperties.bind(store),
  getDevice: store.getDevice.bind(store),
  getKnownTopics: store.getKnownTopics.bind(store),
  updateRule: store.updateRule.bind(store),
  updateRuleWithComments: store.updateRuleWithComments.bind(store),
  setRuleEditing: store.setRuleEditing.bind(store),
  setPersistFn: store.setPersistFn.bind(store),
  setCommandSender: store.setCommandSender.bind(store),
  updateInfo: store.updateInfo.bind(store),
  updateSettingsUi: store.updateSettingsUi.bind(store),
  hydrateFromSnapshots: store.hydrateFromSnapshots.bind(store),
  ingestMessage: store.ingestMessage.bind(store),
  setOnline: store.setOnline.bind(store),
}
