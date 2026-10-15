// users.role değerleri. Patron (executive) kurum genelinde tek roldür. Birim yöneticiliği department_managers tablosundan türetilir, rol olarak tutulmaz.
export const USER_ROLES = ["employee", "system_admin", "executive"] as const;
export type UserRole = (typeof USER_ROLES)[number];
