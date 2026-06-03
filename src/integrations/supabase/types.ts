export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      app_shortcuts: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          notes: string | null
          sort_order: number | null
          url: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          notes?: string | null
          sort_order?: number | null
          url: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          notes?: string | null
          sort_order?: number | null
          url?: string
        }
        Relationships: []
      }
      clients: {
        Row: {
          agreement_link: string | null
          archived: boolean
          calendar_link: string | null
          checkin_form_link: string | null
          coach_notes: string | null
          coaching_package: string | null
          coaching_type: string | null
          created_at: string
          drive_folder_link: string | null
          email: string | null
          full_name: string
          goals: string | null
          id: string
          injuries: string | null
          instagram: string | null
          last_program_update: string | null
          lifestyle_notes: string | null
          next_program_update: string | null
          nutrition_notes: string | null
          payment_status: string | null
          phone: string | null
          program_phase: string | null
          program_sheet_link: string | null
          renewal_date: string | null
          start_date: string | null
          status: string
          stripe_link: string | null
          tags: string[]
          training_notes: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          agreement_link?: string | null
          archived?: boolean
          calendar_link?: string | null
          checkin_form_link?: string | null
          coach_notes?: string | null
          coaching_package?: string | null
          coaching_type?: string | null
          created_at?: string
          drive_folder_link?: string | null
          email?: string | null
          full_name: string
          goals?: string | null
          id?: string
          injuries?: string | null
          instagram?: string | null
          last_program_update?: string | null
          lifestyle_notes?: string | null
          next_program_update?: string | null
          nutrition_notes?: string | null
          payment_status?: string | null
          phone?: string | null
          program_phase?: string | null
          program_sheet_link?: string | null
          renewal_date?: string | null
          start_date?: string | null
          status?: string
          stripe_link?: string | null
          tags?: string[]
          training_notes?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          agreement_link?: string | null
          archived?: boolean
          calendar_link?: string | null
          checkin_form_link?: string | null
          coach_notes?: string | null
          coaching_package?: string | null
          coaching_type?: string | null
          created_at?: string
          drive_folder_link?: string | null
          email?: string | null
          full_name?: string
          goals?: string | null
          id?: string
          injuries?: string | null
          instagram?: string | null
          last_program_update?: string | null
          lifestyle_notes?: string | null
          next_program_update?: string | null
          nutrition_notes?: string | null
          payment_status?: string | null
          phone?: string | null
          program_phase?: string | null
          program_sheet_link?: string | null
          renewal_date?: string | null
          start_date?: string | null
          status?: string
          stripe_link?: string | null
          tags?: string[]
          training_notes?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      communication_log: {
        Row: {
          client_id: string
          comm_type: string | null
          created_at: string
          date: string
          follow_up_needed: boolean | null
          id: string
          priority: string | null
          summary: string | null
        }
        Insert: {
          client_id: string
          comm_type?: string | null
          created_at?: string
          date?: string
          follow_up_needed?: boolean | null
          id?: string
          priority?: string | null
          summary?: string | null
        }
        Update: {
          client_id?: string
          comm_type?: string | null
          created_at?: string
          date?: string
          follow_up_needed?: boolean | null
          id?: string
          priority?: string | null
          summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "communication_log_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      exercises: {
        Row: {
          category: string | null
          common_mistakes: string | null
          created_at: string
          cues: string | null
          difficulty: string | null
          equipment: string | null
          id: string
          muscle_group: string | null
          name: string
          tags: string[] | null
          updated_at: string
          youtube_url: string | null
        }
        Insert: {
          category?: string | null
          common_mistakes?: string | null
          created_at?: string
          cues?: string | null
          difficulty?: string | null
          equipment?: string | null
          id?: string
          muscle_group?: string | null
          name: string
          tags?: string[] | null
          updated_at?: string
          youtube_url?: string | null
        }
        Update: {
          category?: string | null
          common_mistakes?: string | null
          created_at?: string
          cues?: string | null
          difficulty?: string | null
          equipment?: string | null
          id?: string
          muscle_group?: string | null
          name?: string
          tags?: string[] | null
          updated_at?: string
          youtube_url?: string | null
        }
        Relationships: []
      }
      offers: {
        Row: {
          cancel_url: string | null
          checkout_url: string | null
          created_at: string
          currency: string | null
          delivery_notes: string | null
          description: string | null
          id: string
          name: string
          notes: string | null
          offer_type: string | null
          payment_structure: string | null
          price: number | null
          status: string
          stripe_payment_link: string | null
          stripe_price_id: string | null
          stripe_product_id: string | null
          success_url: string | null
          updated_at: string
        }
        Insert: {
          cancel_url?: string | null
          checkout_url?: string | null
          created_at?: string
          currency?: string | null
          delivery_notes?: string | null
          description?: string | null
          id?: string
          name: string
          notes?: string | null
          offer_type?: string | null
          payment_structure?: string | null
          price?: number | null
          status?: string
          stripe_payment_link?: string | null
          stripe_price_id?: string | null
          stripe_product_id?: string | null
          success_url?: string | null
          updated_at?: string
        }
        Update: {
          cancel_url?: string | null
          checkout_url?: string | null
          created_at?: string
          currency?: string | null
          delivery_notes?: string | null
          description?: string | null
          id?: string
          name?: string
          notes?: string | null
          offer_type?: string | null
          payment_structure?: string | null
          price?: number | null
          status?: string
          stripe_payment_link?: string | null
          stripe_price_id?: string | null
          stripe_product_id?: string | null
          success_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "client"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "client"],
    },
  },
} as const
