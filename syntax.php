<?php
/**
 * DokuWiki Plugin Knowledge Graph (Syntax Component)
 */

if(!defined('DOKU_INC')) die();

class syntax_plugin_knowledgegraph extends DokuWiki_Syntax_Plugin {
    public function getType() {
        return 'substition';
    }

    public function getPType() {
        return 'block';
    }

    public function getSort() {
        return 155;
    }

    public function connectTo($mode) {
        $this->Lexer->addSpecialPattern('{{knowledgegraph}}', $mode, 'plugin_knowledgegraph');
    }

    public function handle($match, $state, $pos, Doku_Handler $handler) {
        return array();
    }

    public function render($mode, Doku_Renderer $renderer, $data) {
        if($mode != 'xhtml') return false;

        // Add wrapper with explicit size
        $renderer->doc .= '<div class="knowledge-graph">';
        $renderer->doc .= '<div class="controls">';
        $renderer->doc .= '<select id="namespace-filter" onchange="KnowledgeGraph.showNamespace(this.value)">';
        $renderer->doc .= '<option value="">Show All Namespaces</option>';
        $renderer->doc .= '</select>';
        $renderer->doc .= '</div>';
        $renderer->doc .= '<div id="graph-container"></div>';
        $renderer->doc .= '</div>';
        return true;
    }
}