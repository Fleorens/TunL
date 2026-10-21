// T35: the effective title bar — the setting, unless TUNL_TITLEBAR=native imposes the system one.
use crate::model::{Settings, TitleBarMode, UiSettings};
use crate::window_chrome::{TITLE_BAR_ENV, WindowChrome, effective_title_bar};

fn chrome(mode: TitleBarMode, forced: bool) -> WindowChrome {
    WindowChrome { mode, forced }
}

#[test]
fn the_system_bar_is_the_default() {
    assert_eq!(Settings::default().ui.title_bar, TitleBarMode::Native);
}

#[test]
fn settings_written_before_t35_load_with_the_system_bar() {
    let ui: UiSettings =
        serde_json::from_str(r#"{"sidebarWidth":300,"sidebarCollapsed":false}"#).unwrap();
    assert_eq!(ui.title_bar, TitleBarMode::Native);
    assert_eq!(ui.sidebar_width, 300);
}

#[test]
fn the_mode_is_stored_in_lowercase_under_title_bar() {
    assert_eq!(
        serde_json::to_value(TitleBarMode::Custom).unwrap(),
        serde_json::json!("custom")
    );
    let ui = UiSettings {
        title_bar: TitleBarMode::Custom,
        ..UiSettings::default()
    };
    assert_eq!(
        serde_json::to_value(&ui).unwrap()["titleBar"],
        serde_json::json!("custom")
    );
}

#[test]
fn without_the_variable_the_setting_applies() {
    assert_eq!(
        effective_title_bar(TitleBarMode::Custom, None),
        chrome(TitleBarMode::Custom, false)
    );
    assert_eq!(
        effective_title_bar(TitleBarMode::Native, None),
        chrome(TitleBarMode::Native, false)
    );
}

#[test]
fn the_variable_imposes_the_system_bar() {
    for value in ["native", "NATIVE", " native "] {
        assert_eq!(
            effective_title_bar(TitleBarMode::Custom, Some(value)),
            chrome(TitleBarMode::Native, true),
            "{value:?}"
        );
    }
    assert_eq!(
        effective_title_bar(TitleBarMode::Native, Some("native")),
        chrome(TitleBarMode::Native, true)
    );
}

#[test]
fn other_values_of_the_variable_change_nothing() {
    for value in ["", "custom", "1", "yes"] {
        assert_eq!(
            effective_title_bar(TitleBarMode::Custom, Some(value)),
            chrome(TitleBarMode::Custom, false),
            "{value:?}"
        );
    }
}

#[test]
fn the_variable_is_tunl_titlebar() {
    assert_eq!(TITLE_BAR_ENV, "TUNL_TITLEBAR");
}
