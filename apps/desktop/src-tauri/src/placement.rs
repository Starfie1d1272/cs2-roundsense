#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

/// Computes physical desktop coordinates for the HUD inside the CS2 client rect,
/// supporting multi-monitor setups (including negative origins).
/// Settings uses the same placement for the observed game client rectangle.
pub fn place(game: Rect, width: i32, height: i32, position: &str) -> (i32, i32) {
    let padding = ((game.width as f64 * 0.02).round() as i32).max(12);
    let x = if position == "lower-right" {
        game.x + game.width - padding - width
    } else {
        game.x + padding
    };
    let y = match position {
        "lower-left" => game.y + game.height - (game.height as f64 * 0.14).round() as i32 - height,
        "lower-right" => game.y + game.height - (game.height as f64 * 0.16).round() as i32 - height,
        _ => game.y + (game.height as f64 * 0.34).round() as i32,
    };
    (
        x.clamp(game.x, game.x + (game.width - width).max(0)),
        y.clamp(game.y, game.y + (game.height - height).max(0)),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stays_inside_negative_origin_monitor_and_avoids_native_bottom_hud() {
        let game = Rect {
            x: -1920,
            y: 40,
            width: 1920,
            height: 1080,
        };
        for position in ["below-radar", "lower-left", "lower-right"] {
            let (x, y) = place(game, 264, 140, position);
            assert!(x >= game.x && x + 264 <= game.x + game.width);
            assert!(y >= game.y && y + 140 <= game.y + game.height);
        }
        assert!(place(game, 264, 140, "lower-left").1 + 140 < game.y + 1000);
    }

    #[test]
    fn right_placement_accounts_for_scaled_hud_width() {
        let game = Rect {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        };
        assert_eq!(place(game, 264, 140, "lower-right").0, 1618);
        assert_eq!(place(game, 317, 168, "lower-right").0, 1565);
    }
}
