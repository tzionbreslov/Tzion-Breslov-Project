<?php
// Legacy-widget blocks carry an instance hash made with the live site's salts;
// re-sign them with this install's salts so they render locally.
$fix = function ($content) {
    return preg_replace_callback('/"encoded":"([^"]+)","hash":"[0-9a-f]+"/', function ($m) {
        return '"encoded":"' . $m[1] . '","hash":"' . wp_hash(base64_decode($m[1])) . '"';
    }, $content);
};
$widgets = get_option('widget_block');
foreach ($widgets as $k => $v) {
    if (is_array($v) && isset($v['content'])) $widgets[$k]['content'] = $fix($v['content']);
}
update_option('widget_block', $widgets);
global $wpdb;
foreach ($wpdb->get_results("SELECT ID, post_content FROM {$wpdb->posts} WHERE post_content LIKE '%legacy-widget%'") as $p) {
    $wpdb->update($wpdb->posts, ['post_content' => $fix($p->post_content)], ['ID' => $p->ID]);
}
echo "re-signed legacy widgets\n";
