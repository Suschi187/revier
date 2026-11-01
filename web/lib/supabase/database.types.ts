
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "audit_log": {
                  Row: {
                    "action": string,"actor_id": string | null,"created_at": string,"details": NonNullable<Json>,"id": string,"target_id": string,"target_type": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_id"?: string | null,"created_at"?: string,"details"?: NonNullable<Json>,"id"?: string,"target_id": string,"target_type": string
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string | null,"created_at"?: string,"details"?: NonNullable<Json>,"id"?: string,"target_id"?: string,"target_type"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "audit_log_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["user_id"]
    },{
      foreignKeyName: "audit_log_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "public_profiles"
      referencedColumns: ["user_id"]
    }
                  ]
                },"blocks": {
                  Row: {
                    "blocked_id": string,"blocker_id": string,"created_at": string,"id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "blocked_id": string,"blocker_id"?: string,"created_at"?: string,"id"?: string
                  }
                  Update: {
                    "blocked_id"?: string,"blocker_id"?: string,"created_at"?: string,"id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "blocks_blocked_id_fkey"
      columns: ["blocked_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["user_id"]
    },{
      foreignKeyName: "blocks_blocked_id_fkey"
      columns: ["blocked_id"]
isOneToOne: false
      referencedRelation: "public_profiles"
      referencedColumns: ["user_id"]
    },{
      foreignKeyName: "blocks_blocker_id_fkey"
      columns: ["blocker_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["user_id"]
    },{
      foreignKeyName: "blocks_blocker_id_fkey"
      columns: ["blocker_id"]
isOneToOne: false
      referencedRelation: "public_profiles"
      referencedColumns: ["user_id"]
    }
                  ]
                },"conversations": {
                  Row: {
                    "created_at": string,"id": string,"interested_id": string,"last_message_at": string | null,"listing_id": string | null,"owner_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"interested_id"?: string,"last_message_at"?: string | null,"listing_id"?: string | null,"owner_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"interested_id"?: string,"last_message_at"?: string | null,"listing_id"?: string | null,"owner_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "conversations_interested_id_fkey"
      columns: ["interested_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["user_id"]
    },{
      foreignKeyName: "conversations_interested_id_fkey"
      columns: ["interested_id"]
isOneToOne: false
      referencedRelation: "public_profiles"
      referencedColumns: ["user_id"]
    },{
      foreignKeyName: "conversations_listing_id_fkey"
      columns: ["listing_id"]
isOneToOne: false
      referencedRelation: "listings"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "conversations_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["user_id"]
    },{
      foreignKeyName: "conversations_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "public_profiles"
      referencedColumns: ["user_id"]
    }
                  ]
                },"devices": {
                  Row: {
                    "apns_token": string,"created_at": string,"id": string,"language": Database["public"]['Enums']["language_code"],"platform": Database["public"]['Enums']["device_platform"],"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "apns_token": string,"created_at"?: string,"id"?: string,"language"?: Database["public"]['Enums']["language_code"],"platform"?: Database["public"]['Enums']["device_platform"],"user_id"?: string
                  }
                  Update: {
                    "apns_token"?: string,"created_at"?: string,"id"?: string,"language"?: Database["public"]['Enums']["language_code"],"platform"?: Database["public"]['Enums']["device_platform"],"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "devices_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["user_id"]
    },{
      foreignKeyName: "devices_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "public_profiles"
      referencedColumns: ["user_id"]
    }
                  ]
                },"favorites": {
                  Row: {
                    "created_at": string,"id": string,"listing_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"listing_id": string,"user_id"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"listing_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "favorites_listing_id_fkey"
      columns: ["listing_id"]
isOneToOne: false
      referencedRelation: "listings"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "favorites_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["user_id"]
    },{
      foreignKeyName: "favorites_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "public_profiles"
      referencedColumns: ["user_id"]
    }
                  ]
                },"game_species": {
                  Row: {
                    "code": string,"created_at": string,"id": string,"name_cs": string,"name_de": string,"name_en": string,"name_pl": string
                  }
                  ComputedFields: never
                  Insert: {
                    "code": string,"created_at"?: string,"id"?: string,"name_cs": string,"name_de": string,"name_en": string,"name_pl": string
                  }
                  Update: {
                    "code"?: string,"created_at"?: string,"id"?: string,"name_cs"?: string,"name_de"?: string,"name_en"?: string,"name_pl"?: string
                  }
                  Relationships: [
                    
                  ]
                },"legal_acceptances": {
                  Row: {
                    "accepted_at": string,"document": Database["public"]['Enums']["legal_document"],"id": string,"source": Database["public"]['Enums']["client_source"],"user_id": string,"version": string
                  }
                  ComputedFields: never
                  Insert: {
                    "accepted_at"?: string,"document": Database["public"]['Enums']["legal_document"],"id"?: string,"source": Database["public"]['Enums']["client_source"],"user_id": string,"version": string
                  }
                  Update: {
                    "accepted_at"?: string,"document"?: Database["public"]['Enums']["legal_document"],"id"?: string,"source"?: Database["public"]['Enums']["client_source"],"user_id"?: string,"version"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "legal_acceptances_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["user_id"]
    },{
      foreignKeyName: "legal_acceptances_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "public_profiles"
      referencedColumns: ["user_id"]
    }
                  ]
                },"listing_photos": {
                  Row: {
                    "alt_text": string | null,"created_at": string,"height": number | null,"id": string,"listing_id": string,"processed_at": string | null,"processing_attempts": number,"sort_order": number,"storage_path": string,"thumb_path": string | null,"upload_path": string | null,"width": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "alt_text"?: string | null,"created_at"?: string,"height"?: number | null,"id"?: string,"listing_id": string,"processed_at"?: string | null,"processing_attempts"?: number,"sort_order": number,"storage_path"?: string,"thumb_path"?: string | null,"upload_path"?: string | null,"width"?: number | null
                  }
                  Update: {
                    "alt_text"?: string | null,"created_at"?: string,"height"?: number | null,"id"?: string,"listing_id"?: string,"processed_at"?: string | null,"processing_attempts"?: number,"sort_order"?: number,"storage_path"?: string,"thumb_path"?: string | null,"upload_path"?: string | null,"width"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "listing_photos_listing_id_fkey"
      columns: ["listing_id"]
isOneToOne: false
      referencedRelation: "listings"
      referencedColumns: ["id"]
    }
                  ]
                },"listing_places": {
                  Row: {
                    "listing_id": string,"place_name": string | null,"postal_code": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "listing_id": string,"place_name"?: string | null,"postal_code"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "listing_id"?: string,"place_name"?: string | null,"postal_code"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "listing_places_listing_id_fkey"
      columns: ["listing_id"]
isOneToOne: true
      referencedRelation: "listings"
      referencedColumns: ["id"]
    }
                  ]
                },"listing_species": {
                  Row: {
                    "created_at": string,"listing_id": string,"species_code": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"listing_id": string,"species_code": string
                  }
                  Update: {
                    "created_at"?: string,"listing_id"?: string,"species_code"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "listing_species_listing_id_fkey"
      columns: ["listing_id"]
isOneToOne: false
      referencedRelation: "listings"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "listing_species_species_code_fkey"
      columns: ["species_code"]
isOneToOne: false
      referencedRelation: "game_species"
      referencedColumns: ["code"]
    }
                  ]
                },"listings": {
                  Row: {
                    "approved_at": string | null,"area_hectares": number | null,"attributes": NonNullable<Json>,"content_language": Database["public"]['Enums']["language_code"],"country": Database["public"]['Enums']["country_code"],"created_at": string,"currency": Database["public"]['Enums']["currency_code"] | null,"description": string,"direction": Database["public"]['Enums']["listing_direction"],"display_location": unknown,"end_date": string | null,"expires_at": string | null,"id": string,"kind": Database["public"]['Enums']["listing_kind"],"map_point": unknown,"owner_id": string,"postal_prefix": string | null,"price_minor": number | null,"price_unit": Database["public"]['Enums']["price_unit"] | null,"published_at": string | null,"region_id": string,"reject_code": string | null,"reject_reason": string | null,"search_vector": unknown,"start_date": string | null,"status": Database["public"]['Enums']["listing_status"],"submitted_at": string | null,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "approved_at"?: string | null,"area_hectares"?: number | null,"attributes"?: NonNullable<Json>,"content_language": Database["public"]['Enums']["language_code"],"country": Database["public"]['Enums']["country_code"],"created_at"?: string,"currency"?: Database["public"]['Enums']["currency_code"] | null,"description"?: string,"direction": Database["public"]['Enums']["listing_direction"],"display_location"?: unknown,"end_date"?: string | null,"expires_at"?: string | null,"id"?: string,"kind": Database["public"]['Enums']["listing_kind"],"map_point": unknown,"owner_id"?: string,"postal_prefix"?: string | null,"price_minor"?: number | null,"price_unit"?: Database["public"]['Enums']["price_unit"] | null,"published_at"?: string | null,"region_id": string,"reject_code"?: string | null,"reject_reason"?: string | null,"search_vector"?: never,"start_date"?: string | null,"status"?: Database["public"]['Enums']["listing_status"],"submitted_at"?: string | null,"title": string
                  }
                  Update: {
                    "approved_at"?: string | null,"area_hectares"?: number | null,"attributes"?: NonNullable<Json>,"content_language"?: Database["public"]['Enums']["language_code"],"country"?: Database["public"]['Enums']["country_code"],"created_at"?: string,"currency"?: Database["public"]['Enums']["currency_code"] | null,"description"?: string,"direction"?: Database["public"]['Enums']["listing_direction"],"display_location"?: unknown,"end_date"?: string | null,"expires_at"?: string | null,"id"?: string,"kind"?: Database["public"]['Enums']["listing_kind"],"map_point"?: unknown,"owner_id"?: string,"postal_prefix"?: string | null,"price_minor"?: number | null,"price_unit"?: Database["public"]['Enums']["price_unit"] | null,"published_at"?: string | null,"region_id"?: string,"reject_code"?: string | null,"reject_reason"?: string | null,"search_vector"?: never,"start_date"?: string | null,"status"?: Database["public"]['Enums']["listing_status"],"submitted_at"?: string | null,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "listings_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["user_id"]
    },{
      foreignKeyName: "listings_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "public_profiles"
      referencedColumns: ["user_id"]
    },{
      foreignKeyName: "listings_region_id_fkey"
      columns: ["region_id"]
isOneToOne: false
      referencedRelation: "regions"
      referencedColumns: ["id"]
    }
                  ]
                },"messages": {
                  Row: {
                    "body": string,"conversation_id": string,"created_at": string,"id": string,"read_at": string | null,"sender_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "body": string,"conversation_id": string,"created_at"?: string,"id"?: string,"read_at"?: string | null,"sender_id"?: string
                  }
                  Update: {
                    "body"?: string,"conversation_id"?: string,"created_at"?: string,"id"?: string,"read_at"?: string | null,"sender_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "messages_conversation_id_fkey"
      columns: ["conversation_id"]
isOneToOne: false
      referencedRelation: "conversations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "messages_sender_id_fkey"
      columns: ["sender_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["user_id"]
    },{
      foreignKeyName: "messages_sender_id_fkey"
      columns: ["sender_id"]
isOneToOne: false
      referencedRelation: "public_profiles"
      referencedColumns: ["user_id"]
    }
                  ]
                },"postal_code_places": {
                  Row: {
                    "code": string,"country": Database["public"]['Enums']["country_code"],"place_name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "code": string,"country": Database["public"]['Enums']["country_code"],"place_name": string
                  }
                  Update: {
                    "code"?: string,"country"?: Database["public"]['Enums']["country_code"],"place_name"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "postal_code_places_country_code_fkey"
      columns: ["country","code"]
isOneToOne: false
      referencedRelation: "postal_codes"
      referencedColumns: ["country","code"]
    }
                  ]
                },"postal_code_regions": {
                  Row: {
                    "code": string,"country": Database["public"]['Enums']["country_code"],"region_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "code": string,"country": Database["public"]['Enums']["country_code"],"region_id": string
                  }
                  Update: {
                    "code"?: string,"country"?: Database["public"]['Enums']["country_code"],"region_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "postal_code_regions_country_code_fkey"
      columns: ["country","code"]
isOneToOne: false
      referencedRelation: "postal_codes"
      referencedColumns: ["country","code"]
    },{
      foreignKeyName: "postal_code_regions_region_id_fkey"
      columns: ["region_id"]
isOneToOne: false
      referencedRelation: "regions"
      referencedColumns: ["id"]
    }
                  ]
                },"postal_codes": {
                  Row: {
                    "code": string,"country": Database["public"]['Enums']["country_code"]
                  }
                  ComputedFields: never
                  Insert: {
                    "code": string,"country": Database["public"]['Enums']["country_code"]
                  }
                  Update: {
                    "code"?: string,"country"?: Database["public"]['Enums']["country_code"]
                  }
                  Relationships: [
                    
                  ]
                },"profiles": {
                  Row: {
                    "account_type": Database["public"]['Enums']["account_type"],"business_name": string | null,"country": Database["public"]['Enums']["country_code"],"created_at": string,"deleted_at": string | null,"display_name": string,"id": string,"is_blocked": boolean,"preferred_language": Database["public"]['Enums']["language_code"],"user_id": string,"verification_status": Database["public"]['Enums']["verification_status"]
                  }
                  ComputedFields: never
                  Insert: {
                    "account_type"?: Database["public"]['Enums']["account_type"],"business_name"?: string | null,"country"?: Database["public"]['Enums']["country_code"],"created_at"?: string,"deleted_at"?: string | null,"display_name": string,"id"?: string,"is_blocked"?: boolean,"preferred_language"?: Database["public"]['Enums']["language_code"],"user_id": string,"verification_status"?: Database["public"]['Enums']["verification_status"]
                  }
                  Update: {
                    "account_type"?: Database["public"]['Enums']["account_type"],"business_name"?: string | null,"country"?: Database["public"]['Enums']["country_code"],"created_at"?: string,"deleted_at"?: string | null,"display_name"?: string,"id"?: string,"is_blocked"?: boolean,"preferred_language"?: Database["public"]['Enums']["language_code"],"user_id"?: string,"verification_status"?: Database["public"]['Enums']["verification_status"]
                  }
                  Relationships: [
                    
                  ]
                },"regions": {
                  Row: {
                    "area_km2": number,"centroid": unknown,"code": string,"country": Database["public"]['Enums']["country_code"],"created_at": string,"id": string,"level": Database["public"]['Enums']["region_level"],"name_cs": string,"name_de": string,"name_en": string,"name_pl": string,"parent_id": string | null,"slug": string
                  }
                  ComputedFields: never
                  Insert: {
                    "area_km2": number,"centroid": unknown,"code": string,"country": Database["public"]['Enums']["country_code"],"created_at"?: string,"id"?: string,"level": Database["public"]['Enums']["region_level"],"name_cs": string,"name_de": string,"name_en": string,"name_pl": string,"parent_id"?: string | null,"slug": string
                  }
                  Update: {
                    "area_km2"?: number,"centroid"?: unknown,"code"?: string,"country"?: Database["public"]['Enums']["country_code"],"created_at"?: string,"id"?: string,"level"?: Database["public"]['Enums']["region_level"],"name_cs"?: string,"name_de"?: string,"name_en"?: string,"name_pl"?: string,"parent_id"?: string | null,"slug"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "regions_parent_id_fkey"
      columns: ["parent_id"]
isOneToOne: false
      referencedRelation: "regions"
      referencedColumns: ["id"]
    }
                  ]
                },"reports": {
                  Row: {
                    "created_at": string,"handled_at": string | null,"handled_by": string | null,"id": string,"note": string | null,"reason": Database["public"]['Enums']["report_reason"],"reporter_id": string | null,"status": Database["public"]['Enums']["report_status"],"target_id": string,"target_type": Database["public"]['Enums']["report_target"]
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"handled_at"?: string | null,"handled_by"?: string | null,"id"?: string,"note"?: string | null,"reason": Database["public"]['Enums']["report_reason"],"reporter_id"?: string | null,"status"?: Database["public"]['Enums']["report_status"],"target_id": string,"target_type": Database["public"]['Enums']["report_target"]
                  }
                  Update: {
                    "created_at"?: string,"handled_at"?: string | null,"handled_by"?: string | null,"id"?: string,"note"?: string | null,"reason"?: Database["public"]['Enums']["report_reason"],"reporter_id"?: string | null,"status"?: Database["public"]['Enums']["report_status"],"target_id"?: string,"target_type"?: Database["public"]['Enums']["report_target"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "reports_handled_by_fkey"
      columns: ["handled_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["user_id"]
    },{
      foreignKeyName: "reports_handled_by_fkey"
      columns: ["handled_by"]
isOneToOne: false
      referencedRelation: "public_profiles"
      referencedColumns: ["user_id"]
    },{
      foreignKeyName: "reports_reporter_id_fkey"
      columns: ["reporter_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["user_id"]
    },{
      foreignKeyName: "reports_reporter_id_fkey"
      columns: ["reporter_id"]
isOneToOne: false
      referencedRelation: "public_profiles"
      referencedColumns: ["user_id"]
    }
                  ]
                },"reviews": {
                  Row: {
                    "author_id": string,"conversation_id": string,"created_at": string,"id": string,"rating": number,"target_id": string,"text": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "author_id": string,"conversation_id": string,"created_at"?: string,"id"?: string,"rating": number,"target_id": string,"text"?: string | null
                  }
                  Update: {
                    "author_id"?: string,"conversation_id"?: string,"created_at"?: string,"id"?: string,"rating"?: number,"target_id"?: string,"text"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "reviews_author_id_fkey"
      columns: ["author_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["user_id"]
    },{
      foreignKeyName: "reviews_author_id_fkey"
      columns: ["author_id"]
isOneToOne: false
      referencedRelation: "public_profiles"
      referencedColumns: ["user_id"]
    },{
      foreignKeyName: "reviews_conversation_id_fkey"
      columns: ["conversation_id"]
isOneToOne: false
      referencedRelation: "conversations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "reviews_target_id_fkey"
      columns: ["target_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["user_id"]
    },{
      foreignKeyName: "reviews_target_id_fkey"
      columns: ["target_id"]
isOneToOne: false
      referencedRelation: "public_profiles"
      referencedColumns: ["user_id"]
    }
                  ]
                },"saved_searches": {
                  Row: {
                    "created_at": string,"filters": NonNullable<Json>,"id": string,"last_notified_at": string | null,"name": string,"notify_email": boolean,"notify_push": boolean,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"filters"?: NonNullable<Json>,"id"?: string,"last_notified_at"?: string | null,"name": string,"notify_email"?: boolean,"notify_push"?: boolean,"user_id"?: string
                  }
                  Update: {
                    "created_at"?: string,"filters"?: NonNullable<Json>,"id"?: string,"last_notified_at"?: string | null,"name"?: string,"notify_email"?: boolean,"notify_push"?: boolean,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "saved_searches_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["user_id"]
    },{
      foreignKeyName: "saved_searches_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "public_profiles"
      referencedColumns: ["user_id"]
    }
                  ]
                },"verifications": {
                  Row: {
                    "created_at": string,"decided_at": string | null,"document_deleted_at": string | null,"document_path": string | null,"document_type": Database["public"]['Enums']["document_type"],"id": string,"reject_reason": string | null,"reviewed_at": string | null,"reviewed_by": string | null,"status": Database["public"]['Enums']["verification_request_status"],"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"decided_at"?: string | null,"document_deleted_at"?: string | null,"document_path"?: string | null,"document_type": Database["public"]['Enums']["document_type"],"id"?: string,"reject_reason"?: string | null,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"status"?: Database["public"]['Enums']["verification_request_status"],"user_id"?: string
                  }
                  Update: {
                    "created_at"?: string,"decided_at"?: string | null,"document_deleted_at"?: string | null,"document_path"?: string | null,"document_type"?: Database["public"]['Enums']["document_type"],"id"?: string,"reject_reason"?: string | null,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"status"?: Database["public"]['Enums']["verification_request_status"],"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "verifications_reviewed_by_fkey"
      columns: ["reviewed_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["user_id"]
    },{
      foreignKeyName: "verifications_reviewed_by_fkey"
      columns: ["reviewed_by"]
isOneToOne: false
      referencedRelation: "public_profiles"
      referencedColumns: ["user_id"]
    },{
      foreignKeyName: "verifications_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["user_id"]
    },{
      foreignKeyName: "verifications_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "public_profiles"
      referencedColumns: ["user_id"]
    }
                  ]
                }
          }
          Views: {
            "public_profiles": {
                  Row: {
                    "account_type": Database["public"]['Enums']["account_type"],"business_name": string | null,"country": Database["public"]['Enums']["country_code"],"display_name": string,"user_id": string,"verification_status": Database["public"]['Enums']["verification_status"] | null
                  }
                  ComputedFields: never
                  Insert: {
                           "account_type"?: Database["public"]['Enums']["account_type"] | null,"business_name"?: never,"country"?: Database["public"]['Enums']["country_code"] | null,"display_name"?: string | null,"user_id"?: string | null,"verification_status"?: never
                         }
                        Update: {
                           "account_type"?: Database["public"]['Enums']["account_type"] | null,"business_name"?: never,"country"?: Database["public"]['Enums']["country_code"] | null,"display_name"?: string | null,"user_id"?: string | null,"verification_status"?: never
                         }
                        Relationships: [
                    
                  ]
                }
          }
          Functions: {
            "accept_legal":
{ Args: { "p_privacy_version": string,"p_source": Database["public"]['Enums']["client_source"],"p_terms_version": string }; Returns: undefined
                           },
"admin_access":
{ Args: Record<PropertyKey, never>; Returns: {
              "aal2": boolean,"has_role": boolean
            }[]
                           },
"admin_find_user":
{ Args: { "p_email": string }; Returns: {
              "display_name": string,"is_admin": boolean,"member_since": string,"user_id": string
            }[]
                           },
"admin_list_admins":
{ Args: Record<PropertyKey, never>; Returns: {
              "active": boolean,"admin_since": string,"display_name": string,"user_id": string
            }[]
                           },
"admin_listing_version":
{ Args: { "p_listing_id": string }; Returns: string
                           },
"admin_review_queue":
{ Args: { "p_after_id"?: string,"p_after_submitted"?: string,"p_limit"?: number }; Returns: {
              "country": Database["public"]['Enums']["country_code"],"direction": Database["public"]['Enums']["listing_direction"],"hint_count": number,"id": string,"kind": Database["public"]['Enums']["listing_kind"],"listing_rejections": number,"owner_id": string,"owner_name": string,"owner_rejections": number,"region_id": string,"submitted_at": string,"title": string
            }[]
                           },
"admin_role_rules":
{ Args: Record<PropertyKey, never>; Returns: {
              "limit_per_admin": number,"limit_total": number,"waiting_days": number
            }[]
                           },
"claim_photo_processing":
{ Args: { "p_photo_id": string,"p_user_id": string }; Returns: {
              "state": string,"storage_path": string,"thumb_path": string,"upload_path": string
            }[]
                           },
"complete_photo_processing":
{ Args: { "p_height": number,"p_photo_id": string,"p_width": number }; Returns: string
                           },
"grant_admin":
{ Args: { "p_user_id": string }; Returns: undefined
                           },
"legal_status":
{ Args: Record<PropertyKey, never>; Returns: {
              "accepted": boolean,"privacy_version": string,"terms_version": string
            }[]
                           },
"listing_content_hints":
{ Args: { "p_listing_id": string }; Returns: {
              "category": string,"field": string,"language": Database["public"]['Enums']["language_code"],"term": string
            }[]
                           },
"listing_region_counts":
{ Args: { "p_kind"?: Database["public"]['Enums']["listing_kind"] }; Returns: {
              "level": Database["public"]['Enums']["region_level"],"listings": number,"region_code": string
            }[]
                           },
"map_listings":
{ Args: { "p_filters": Json }; Returns: Json
                           },
"moderate_listing":
{ Args: { "p_code"?: string,"p_decision": string,"p_expected_version": string,"p_listing_id": string,"p_note"?: string }; Returns: Database["public"]['Enums']["listing_status"]
                           },
"my_favorites":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"provider_listings":
{ Args: { "p_cursor"?: string,"p_limit"?: number,"p_owner": string }; Returns: Json
                           },
"public_cache_epoch":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"public_page_state":
{ Args: { "p_id": string,"p_kind": string }; Returns: string
                           },
"register_device":
{ Args: { "apns_token": string,"language"?: Database["public"]['Enums']["language_code"] }; Returns: undefined
                           },
"remove_unavailable_favorites":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"reorder_listing_photos":
{ Args: { "p_listing_id": string,"p_photo_ids": (string)[] }; Returns: undefined
                           },
"revoke_admin":
{ Args: { "p_user_id": string }; Returns: undefined
                           },
"search_listings":
{ Args: { "p_cursor"?: string,"p_filters": Json,"p_limit"?: number }; Returns: Json
                           },
"set_listing_location":
{ Args: { "p_lat"?: number,"p_listing_id": string,"p_lng"?: number,"p_place_name"?: string,"p_point"?: string,"p_postal_code"?: string,"p_region_id": string }; Returns: undefined
                           }
          }
          Enums: {
            "account_type": "private"|"business","client_source": "web"|"ios","country_code": "DE"|"AT"|"CH"|"CZ"|"PL","currency_code": "EUR"|"CHF"|"CZK"|"PLN","device_platform": "ios","document_type": "jagdschein"|"jagdkarte"|"revierbescheinigung"|"gewerbe","language_code": "de"|"en"|"cs"|"pl","legal_document": "terms"|"privacy","listing_direction": "offer"|"wanted","listing_kind": "lease"|"permit"|"driven_hunt"|"trophy_hunt"|"helper","listing_status": "draft"|"pending_review"|"active"|"paused"|"expired"|"rejected"|"removed","price_unit": "total"|"per_year"|"per_hectare_year"|"per_day"|"per_animal"|"on_request","region_level": "state"|"district","report_reason": "scam"|"illegal"|"weapons"|"harassment"|"wrong_category"|"other","report_status": "open"|"handled","report_target": "listing"|"message"|"profile","verification_request_status": "pending"|"verified"|"rejected","verification_status": "none"|"pending"|"verified"|"rejected"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            "account_type": ["private", "business"],"client_source": ["web", "ios"],"country_code": ["DE", "AT", "CH", "CZ", "PL"],"currency_code": ["EUR", "CHF", "CZK", "PLN"],"device_platform": ["ios"],"document_type": ["jagdschein", "jagdkarte", "revierbescheinigung", "gewerbe"],"language_code": ["de", "en", "cs", "pl"],"legal_document": ["terms", "privacy"],"listing_direction": ["offer", "wanted"],"listing_kind": ["lease", "permit", "driven_hunt", "trophy_hunt", "helper"],"listing_status": ["draft", "pending_review", "active", "paused", "expired", "rejected", "removed"],"price_unit": ["total", "per_year", "per_hectare_year", "per_day", "per_animal", "on_request"],"region_level": ["state", "district"],"report_reason": ["scam", "illegal", "weapons", "harassment", "wrong_category", "other"],"report_status": ["open", "handled"],"report_target": ["listing", "message", "profile"],"verification_request_status": ["pending", "verified", "rejected"],"verification_status": ["none", "pending", "verified", "rejected"]
          }
        }
} as const
