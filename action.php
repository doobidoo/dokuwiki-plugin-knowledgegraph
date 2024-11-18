<?php
/**
 * DokuWiki Plugin Knowledge Graph (Action Component)
 */

if(!defined('DOKU_INC')) die();

class action_plugin_knowledgegraph extends DokuWiki_Action_Plugin {
    public function register(Doku_Event_Handler $controller) {
        $controller->register_hook('TPL_METAHEADER_OUTPUT', 'BEFORE', $this, 'loadResources');
        $controller->register_hook('AJAX_CALL_UNKNOWN', 'BEFORE', $this, 'handleAjax');
    }

    public function loadResources(Doku_Event $event, $param) {
        // Add D3.js
        $event->data['script'][] = array(
            'type'    => 'text/javascript',
            'src'     => 'https://cdnjs.cloudflare.com/ajax/libs/d3/7.8.5/d3.min.js',
            '_data'   => '',
        );
        
        // Add our main script
        $event->data['script'][] = array(
            'type'    => 'text/javascript',
            'src'     => DOKU_BASE.'lib/plugins/knowledgegraph/script.js',
            '_data'   => '',
        );

        // Add initialization code using DokuWiki's JSINFO approach
        $event->data['script'][] = array(
            'type'    => 'text/javascript',
            '_data'   => 'JSINFO["plugin_knowledgegraph"] = {initialized: false};'
        );

        // Add the init code that will run after all scripts are loaded
        $event->data['script'][] = array(
            'type'    => 'text/javascript',
            '_data'   => 'window.addEventListener("load", function() {
                if (typeof KnowledgeGraph !== "undefined" && !JSINFO["plugin_knowledgegraph"].initialized) {
                    JSINFO["plugin_knowledgegraph"].initialized = true;
                    KnowledgeGraph.init();
                }
            });'
        );

        // Add CSS styles
        $event->data['link'][] = array(
            'type'    => 'text/css',
            'rel'     => 'stylesheet',
            'href'    => DOKU_BASE.'lib/plugins/knowledgegraph/style.css',
        );
    }

    public function handleAjax(Doku_Event $event, $param) {
        if($event->data !== 'plugin_knowledgegraph') return;
        
        global $INPUT;
        if($INPUT->str('req') !== 'getgraph') return;

        $event->stopPropagation();
        $event->preventDefault();

        header('Content-Type: application/json');
        $parser = new helper_plugin_knowledgegraph_parser();
        echo json_encode($parser->getGraphData());
    }
}