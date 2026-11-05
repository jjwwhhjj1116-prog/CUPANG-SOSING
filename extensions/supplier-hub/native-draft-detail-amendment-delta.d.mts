import type {NativeAssetSourceImage,NativeAssetSourcePlan} from '../../app/native-asset-source-plan';
import type {SupplierHubProductDocumentReview} from '../../app/supplier-hub-product-document';
import type {QuotationFieldsView} from '../../app/quotation-schema';
import type {WorkspaceSettings} from '../../app/workspace-settings';
import type {WorkspaceSettingsScope} from '../../app/workspace-settings-scope';

export type NativeDraftDetailAmendmentSource={review:SupplierHubProductDocumentReview;nativePlan:NativeAssetSourcePlan;quotationView:QuotationFieldsView;settings:{settings:WorkspaceSettings;scope:WorkspaceSettingsScope}};
export type NativeDraftDetailAmendmentDelta=Readonly<{
 format:'yoofam-native-draft-detail-amendment-delta-v1';
 deltaSha256:string;
 allowedPaths:ReadonlyArray<Readonly<{documentIndex:number;wire:Readonly<{path:ReadonlyArray<string>}>}>>;
 newDetailFiles:ReadonlyArray<Readonly<NativeAssetSourceImage>>;
 retainedDetailFiles:ReadonlyArray<Readonly<NativeAssetSourceImage>>;
}>;
/** Returns a sealed DETAIL-only proof or throws NativeDraftDetailAmendmentError. */
export function validateNativeDraftDetailAmendmentDelta(parentSource:unknown,nextSource:unknown):Promise<NativeDraftDetailAmendmentDelta>;
