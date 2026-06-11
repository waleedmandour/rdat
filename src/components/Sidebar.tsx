import React from "react";
import { NavItem } from "../types";
import { useLanguage } from "../context/LanguageContext";
import { 
  Languages, 
  BookOpen, 
  Cpu, 
  Key, 
  Settings, 
  ChevronLeft, 
  ChevronRight,
  BookMarked
} from "lucide-react";
import { cn } from "../lib/utils";

interface SidebarProps {
  activeItem: NavItem;
  onNavItemChange: (item: NavItem) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onOpenGuide: () => void;
}

export function Sidebar({
  activeItem,
  onNavItemChange,
  collapsed,
  onToggleCollapsed,
  onOpenGuide,
}: SidebarProps) {
  const { t, locale, setLocale } = useLanguage();
  const isRTL = locale === "ar";

  const menuItems = [
    { id: "translator" as NavItem, label: t("nav.translator"), icon: Languages },
    { id: "glossary" as NavItem, label: t("nav.glossary"), icon: BookOpen },
    { id: "models" as NavItem, label: t("nav.models"), icon: Cpu },
    { id: "api-keys" as NavItem, label: t("nav.apiKeys"), icon: Key },
    { id: "settings" as NavItem, label: t("nav.settings"), icon: Settings },
  ];

  return (
    <aside
      className={cn(
        "bg-surface border-r border-border h-full flex flex-col justify-between transition-all duration-300",
        collapsed ? "w-14" : "w-64"
      )}
    >
      <div className="flex flex-col gap-4">
        {/* Logo Header */}
        <div className="h-14 border-b border-border flex items-center px-4 justify-between">
          {!collapsed && (
            <div className="flex items-center gap-2 font-bold text-base text-primary">
              <BookMarked className="w-5 h-5 text-primary" />
              <span>{t("sidebar.copilot")}</span>
            </div>
          )}
          {collapsed && <BookMarked className="w-5 h-5 text-primary mx-auto" />}

          <button
            onClick={onToggleCollapsed}
            className="p-1 rounded hover:bg-surface-hover text-muted-foreground transition-colors cursor-pointer"
            title={collapsed ? t("sidebar.expand") : t("sidebar.collapse")}
          >
            {collapsed ? (
              isRTL ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />
            ) : (
              isRTL ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />
            )}
          </button>
        </div>

        {/* Navigation Items */}
        <nav className="flex flex-col gap-1 px-2">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeItem === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onNavItemChange(item.id)}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all cursor-pointer w-full text-left",
                  isRTL && "text-right",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                )}
              >
                <Icon className="w-5 h-5 shrink-0" />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Footer Area with Language Switch and Guide */}
      <div className="p-2 border-t border-border flex flex-col gap-2">
        <button
          onClick={onOpenGuide}
          className={cn(
            "flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-semibold text-muted-foreground hover:bg-surface-hover hover:text-foreground cursor-pointer text-left",
            isRTL && "text-right"
          )}
        >
          <BookMarked className="w-4 h-4 shrink-0" />
          {!collapsed && <span>{locale === "en" ? "Quick Guide" : "دليل المساعدة"}</span>}
        </button>

        <button
          onClick={() => setLocale(locale === "en" ? "ar" : "en")}
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-bold text-primary hover:bg-primary/5 cursor-pointer text-left"
        >
          <Languages className="w-4 h-4 shrink-0 text-primary" />
          {!collapsed && <span>{locale === "en" ? "العربية (AR)" : "English (EN)"}</span>}
        </button>
      </div>
    </aside>
  );
}
export default Sidebar;
